-- Full initialization script
-- 1) Create database (run as superuser, optional)
-- CREATE DATABASE vpn_new;

-- 2) Connect to the database (pgAdmin обычно уже подключён)
-- \c vpn_new

-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.users_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.tariffs_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.peers_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.peer_logs_id_seq;

-- Tables
CREATE TABLE IF NOT EXISTS public.users
(
  id integer NOT NULL DEFAULT nextval('users_id_seq'::regclass),
  telegram_id bigint NOT NULL,
  username text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  vpn_status text DEFAULT 'active'::text,
  connections_count integer DEFAULT 0,
  tariff_id integer,
  tariff_expiry timestamp without time zone,
  comment text,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.tariffs
(
  id integer NOT NULL DEFAULT nextval('tariffs_id_seq'::regclass),
  name text NOT NULL,
  duration_months integer NOT NULL,
  price numeric(10,2) NOT NULL,
  description text,
  duration_days integer DEFAULT 0,
  CONSTRAINT tariffs_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.servers
(
  id text NOT NULL,
  name text NOT NULL,
  ip text NOT NULL,
  location text,
  is_default boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT servers_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.peers
(
  id integer NOT NULL DEFAULT nextval('peers_id_seq'::regclass),
  user_id integer,
  server_id text,
  name text NOT NULL,
  public_key text NOT NULL,
  private_key text NOT NULL,
  ip text NOT NULL,
  created_at timestamp without time zone DEFAULT now(),
  active boolean DEFAULT true,
  CONSTRAINT peers_pkey PRIMARY KEY (id),
  CONSTRAINT peers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT peers_server_id_fkey FOREIGN KEY (server_id) REFERENCES public.servers(id)
);

CREATE TABLE IF NOT EXISTS public.peer_logs
(
  id integer NOT NULL DEFAULT nextval('peer_logs_id_seq'::regclass),
  user_id integer,
  peer_name text,
  action text NOT NULL,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT peer_logs_pkey PRIMARY KEY (id),
  CONSTRAINT peer_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

-- FK users -> tariffs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_tariff_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_tariff_id_fkey FOREIGN KEY (tariff_id)
      REFERENCES public.tariffs(id);
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_uq ON public.users (telegram_id);
CREATE UNIQUE INDEX IF NOT EXISTS peers_name_uq ON public.peers (name);
CREATE INDEX IF NOT EXISTS peers_user_id_idx ON public.peers (user_id);
CREATE INDEX IF NOT EXISTS peers_server_id_idx ON public.peers (server_id);
CREATE INDEX IF NOT EXISTS peer_logs_user_id_idx ON public.peer_logs (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS servers_name_uq ON public.servers (name);
CREATE UNIQUE INDEX IF NOT EXISTS servers_ip_uq ON public.servers (ip);
CREATE UNIQUE INDEX IF NOT EXISTS tariffs_name_uq ON public.tariffs (name);

-- Seed data
INSERT INTO public.servers (id, name, ip, location, is_default)
VALUES ('server-1', 'Main Server', '109.107.170.233', 'Main', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tariffs (name, duration_months, price, description, duration_days)
VALUES ('tester', 0, 0.00, 'Тестовый тариф', 0)
ON CONFLICT (name) DO NOTHING;
