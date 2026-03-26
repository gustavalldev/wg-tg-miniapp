require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:3002';
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '30', 10);
const TRIAL_TARIFF_CODE = process.env.TRIAL_TARIFF_CODE || 'trial-30d';

const pool = new Pool({
    host: process.env.PG_HOST,
    port: process.env.PG_PORT,
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
});

// Stop processing for users explicitly blocked in the database
bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) {
        return next();
    }

    try {
        const res = await pool.query(
            'SELECT vpn_status FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (res.rows.length > 0 && res.rows[0].vpn_status === 'blocked') {
            await ctx.reply('🚫 Доступ к боту ограничен. Обратитесь в поддержку.');
            return;
        }
    } catch (err) {
        console.error('Ошибка проверки статуса пользователя:', err.message);
        try {
            await ctx.reply('❌ Временная ошибка. Попробуйте позже.');
        } catch (replyErr) {
            handleTelegramError(replyErr, ctx);
        }
        return;
    }

    return next();
});

const mainMenuMarkup = {
    reply_markup: {
        inline_keyboard: [
            [{ text: 'Открыть приложение', web_app: { url: WEBAPP_URL } }],
            [{ text: 'Поддержка', callback_data: 'help' }]
        ]
    }
};

function makeReferralCode() {
    return require('crypto').randomBytes(5).toString('hex');
}

async function getTariffByCode(code) {
    const result = await pool.query(
        'SELECT id FROM tariffs WHERE code = $1 LIMIT 1',
        [code]
    );
    return result.rows[0] || null;
}

async function ensureBotSchema() {
    const statements = [
        'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code text',
        'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_by_user_id integer',
        'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_at timestamp without time zone',
        'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_reward_granted_at timestamp without time zone',
        'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS code text',
        'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true',
        'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0',
        `CREATE TABLE IF NOT EXISTS public.payments (
            id serial PRIMARY KEY,
            user_id integer NOT NULL REFERENCES public.users(id),
            tariff_id integer NOT NULL REFERENCES public.tariffs(id),
            amount numeric(10,2) NOT NULL,
            currency text NOT NULL DEFAULT 'RUB',
            status text NOT NULL DEFAULT 'pending',
            provider text NOT NULL DEFAULT 'manual',
            provider_ref text,
            details jsonb DEFAULT '{}'::jsonb,
            created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
            paid_at timestamp without time zone,
            rejected_at timestamp without time zone
        )`,
        `CREATE TABLE IF NOT EXISTS public.promo_codes (
            id serial PRIMARY KEY,
            code text NOT NULL,
            description text,
            duration_days integer NOT NULL DEFAULT 30,
            max_redemptions integer NOT NULL DEFAULT 1,
            active boolean DEFAULT true,
            created_by_user_id integer REFERENCES public.users(id),
            created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
            expires_at timestamp without time zone
        )`,
        `CREATE TABLE IF NOT EXISTS public.promo_code_redemptions (
            id serial PRIMARY KEY,
            promo_code_id integer NOT NULL REFERENCES public.promo_codes(id),
            user_id integer NOT NULL REFERENCES public.users(id),
            granted_days integer NOT NULL DEFAULT 0,
            redeemed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
        )`,
        'CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uq ON public.users (referral_code)',
        'CREATE UNIQUE INDEX IF NOT EXISTS tariffs_code_uq ON public.tariffs (code)',
        'CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_uq ON public.promo_codes (code)',
        'CREATE UNIQUE INDEX IF NOT EXISTS promo_code_redemptions_promo_user_uq ON public.promo_code_redemptions (promo_code_id, user_id)'
    ];

    for (const statement of statements) {
        await pool.query(statement);
    }

    await pool.query(
        `INSERT INTO public.tariffs (code, name, duration_months, price, description, duration_days, is_active, sort_order)
         VALUES
           ('trial-30d', 'Пробный период', 1, 0.00, 'Первый месяц бесплатно', 30, true, 0),
           ('plan-1m', '1 месяц', 1, 190.00, 'Подписка на 1 месяц', 30, true, 10),
           ('plan-3m', '3 месяца', 3, 490.00, 'Подписка на 3 месяца', 90, true, 20),
           ('plan-6m', '6 месяцев', 6, 990.00, 'Подписка на 6 месяцев', 180, true, 30),
           ('plan-lifetime', 'Навсегда', 1200, 9000.00, 'Пожизненный доступ без продления', 36500, true, 40),
           ('service-personal-vpn', 'Личный VPN сервер', 0, 15000.00, 'Разработка и настройка отдельного личного VPN сервера', 0, true, 50),
           ('promo-access', 'Промокод', 0, 0.00, 'Доступ, активированный через промокод', 0, true, 90),
           ('tester', 'tester', 0, 0.00, 'Тестовый тариф', 0, true, 100)
         ON CONFLICT (code) DO NOTHING`
    );
}

function computeExpiryFromDays(durationDays) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    return expiresAt;
}

async function ensureUniqueReferralCode() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = makeReferralCode();
        const existing = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
        if (existing.rows.length === 0) {
            return code;
        }
    }

    throw new Error('Не удалось сгенерировать referral code');
}

async function attachReferralByCode(userId, referralCode) {
    const sanitizedCode = String(referralCode || '').trim().toLowerCase().replace(/^ref[_-]?/i, '');
    if (!sanitizedCode) return;

    const userRes = await pool.query(
        'SELECT id, referred_by_user_id, referral_code FROM users WHERE id = $1',
        [userId]
    );
    const user = userRes.rows[0];
    if (!user || user.referred_by_user_id || user.referral_code === sanitizedCode) {
        return;
    }

    const referrerRes = await pool.query(
        'SELECT id FROM users WHERE referral_code = $1 LIMIT 1',
        [sanitizedCode]
    );
    const referrer = referrerRes.rows[0];
    if (!referrer || referrer.id === userId) {
        return;
    }

    const paidPayments = await pool.query(
        'SELECT 1 FROM payments WHERE user_id = $1 AND status = $2 LIMIT 1',
        [userId, 'paid']
    );
    if (paidPayments.rows.length > 0) {
        return;
    }

    await pool.query(
        `UPDATE users
         SET referred_by_user_id = $1, referred_at = COALESCE(referred_at, NOW())
         WHERE id = $2 AND referred_by_user_id IS NULL`,
        [referrer.id, userId]
    );
}

async function ensureUser(ctx, options = {}) {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || null;
    const userCheck = await pool.query(
        'SELECT id, referral_code, referred_by_user_id FROM users WHERE telegram_id = $1',
        [telegramId]
    );

    if (userCheck.rows.length === 0) {
        const referralCode = await ensureUniqueReferralCode();
        const trialTariff = await getTariffByCode(TRIAL_TARIFF_CODE);
        await pool.query(
            `INSERT INTO users (telegram_id, username, tariff_id, tariff_expiry, referral_code, vpn_status)
             VALUES ($1, $2, $3, $4, $5, 'active')`,
            [telegramId, username, trialTariff?.id || null, computeExpiryFromDays(TRIAL_DAYS), referralCode]
        );
        console.log(`Добавлен новый пользователь: ${telegramId} (${username})`);
    } else {
        const currentUser = userCheck.rows[0];
        if (!currentUser.referral_code) {
            const referralCode = await ensureUniqueReferralCode();
            await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, currentUser.id]);
        }
    }

    const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    const userId = userRes.rows[0]?.id;
    if (userId && options.referralCode) {
        await attachReferralByCode(userId, options.referralCode);
    }

    return userId;
}

// /start
bot.start(async (ctx) => {
    try {
        const referralCode = ctx.startPayload || ctx.message?.text?.split(' ').slice(1).join(' ') || null;
        await ensureUser(ctx, { referralCode });

        await ctx.replyWithPhoto(
            { source: 'media/logo_bot.png' },
            {
                caption:
                    'VPN_GuardBot — смотри тикток (и не только) без проблем.\n\n' +
                    '🔓 Доступ ко всем социальным сетям\n' +
                    '🕒 Работает 24/7\n' +
                    '🚀 Быстрая скорость\n\n' +
                    'Откройте приложение для управления профилем доступа.',
                ...mainMenuMarkup
            }
        );
    } catch (err) {
        handleTelegramError(err, ctx);
    }
});

bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Приложение уже доступно. Откройте мини-апп.', mainMenuMarkup);
});

bot.action('help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Связаться с поддержкой: @vpnguardsupport', mainMenuMarkup);
});

function handleTelegramError(err, ctx) {
    if (err.response?.data?.description?.includes('bot was blocked')) {
        console.warn(`⚠️ Пользователь ${ctx.from?.id} заблокировал бота`);
    } else {
        console.error('Ошибка Telegram:', err.message);
    }
}

async function startBot() {
    try {
        await ensureBotSchema();
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Открыть приложение' },
            { command: 'help', description: 'Поддержка' }
        ]);
    } catch (err) {
        console.error('Не удалось обновить команды бота:', err.message);
    }

    await bot.launch();
}

startBot().catch((err) => {
    console.error('Не удалось запустить бота:', err);
    process.exit(1);
});
