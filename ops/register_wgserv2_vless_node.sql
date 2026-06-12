BEGIN;

UPDATE public.routes
SET enabled = false,
    is_default = false
WHERE id = 'ru-foreign-default';

UPDATE public.servers
SET enabled = false,
    is_default = false
WHERE id IN ('ru-entry-main', 'foreign-exit-main');

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
  is_default,
  provisioner_url
)
VALUES (
  'wgserv-vless-02',
  'WGServ VLESS 02',
  '192.124.190.175',
  '192.124.190.175.sslip.io',
  'Singapore',
  'vpn-node',
  'SG',
  'xray',
  'online',
  true,
  false,
  'http://192.124.190.175:3021'
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
  is_default = EXCLUDED.is_default,
  provisioner_url = EXCLUDED.provisioner_url;

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
  'wgserv-vless-02',
  'WGServ VLESS 02 · Singapore',
  'wgserv-vless-02',
  'wgserv-vless-02',
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
