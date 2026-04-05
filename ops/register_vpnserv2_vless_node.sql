BEGIN;

INSERT INTO public.servers (
  id,
  name,
  ip,
  host,
  location,
  role,
  country_code,
  provider,
  status,
  enabled,
  is_default
)
VALUES (
  'foreign-vless-ru-02',
  'VLESS Node 2',
  '109.107.170.233',
  '183555.hosted-by-kvmka.com',
  'Russia',
  'vpn-node',
  'RU',
  'xray',
  'online',
  true,
  false
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  ip = EXCLUDED.ip,
  host = EXCLUDED.host,
  location = EXCLUDED.location,
  role = EXCLUDED.role,
  country_code = EXCLUDED.country_code,
  provider = EXCLUDED.provider,
  status = EXCLUDED.status,
  enabled = EXCLUDED.enabled,
  is_default = EXCLUDED.is_default;

COMMIT;
