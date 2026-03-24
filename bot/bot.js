require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const { Pool } = require('pg');
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL || 'http://localhost:3002';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@kirillprodev';

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

function getSubscribeMarkup() {
    const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Подписаться на канал', url: channelLink }],
                [{ text: 'Проверить подписку', callback_data: 'check_subscription' }]
            ]
        }
    };
}

async function ensureUser(ctx) {
    const telegramId = ctx.from.id;
    const username = ctx.from.username || null;
    const userCheck = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (userCheck.rows.length === 0) {
        await pool.query(
            'INSERT INTO users (telegram_id, username) VALUES ($1, $2)',
            [telegramId, username]
        );
        console.log(`Добавлен новый пользователь: ${telegramId} (${username})`);
    }
}

async function isUserSubscribed(telegramId) {
    try {
        const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, telegramId);
        const status = chatMember?.status;
        return ['creator', 'administrator', 'member'].includes(status);
    } catch (err) {
        console.error('Ошибка проверки подписки:', err.message);
        return true;
    }
}

async function sendSubscribeMessage(ctx) {
    await ctx.reply(
        'Чтобы пользоваться VPN и мини‑аппом, подпишитесь на канал и нажмите «Проверить подписку».',
        getSubscribeMarkup()
    );
}

// /start
bot.start(async (ctx) => {
    try {
        await ensureUser(ctx);
        const subscribed = await isUserSubscribed(ctx.from.id);
        if (!subscribed) {
            await sendSubscribeMessage(ctx);
            return;
        }

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
    const subscribed = await isUserSubscribed(ctx.from.id);
    if (!subscribed) {
        await sendSubscribeMessage(ctx);
        return;
    }

    await ctx.reply('Подписка подтверждена. Теперь можно открыть приложение.', mainMenuMarkup);
});

bot.action('help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Связаться с поддержкой: @kkasyanov', mainMenuMarkup);
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
