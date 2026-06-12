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
  'wgserv-vless-01',
  'WGServ VLESS',
  '109.107.170.43',
  'vpnguardbot.org',
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

INSERT INTO public.routes (
  id,
  name,
  entry_server_id,
  exit_server_id,
  protocol,
  profile_format,
  enabled,
  is_default
)
VALUES (
  'wgserv-vless-01',
  'WGServ VLESS · Russia',
  'wgserv-vless-01',
  'wgserv-vless-01',
  'VLESS',
  'uri',
  true,
  false
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  entry_server_id = EXCLUDED.entry_server_id,
  exit_server_id = EXCLUDED.exit_server_id,
  protocol = EXCLUDED.protocol,
  profile_format = EXCLUDED.profile_format,
  enabled = EXCLUDED.enabled,
  is_default = EXCLUDED.is_default;

COMMIT;
