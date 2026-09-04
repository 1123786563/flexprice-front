// Minimal OIDC provider for the SSO e2e profile. Serves discovery, JWKS,
// authorize (auto-approve) and token endpoints; signs RS256 id_tokens with an
// in-process key. Claims are fixed via env so the backend under test lands in
// a known organization.
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

const issuer = process.env.FAKE_OIDP_URL ?? 'http://127.0.0.1:9401';
const clientId = process.env.FAKE_OIDP_CLIENT_ID ?? 'openmeter';
const organization = process.env.FAKE_OIDP_ORGANIZATION ?? 'acme';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });

const b64u = (value) => Buffer.from(value).toString('base64url');

function signIDToken() {
	const now = Math.floor(Date.now() / 1000);
	const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'e2e-key' }));
	// Claim shape deliberately mirrors the Go test fakeIDP
	// (openmeter/auth/handler_test.go): this IdP sends only the
	// "organization" claim while the Go fakeIDP sends only "owner" — the two
	// fixtures exercise both claim paths; keep them in sync when changing
	// shapes.
	const payload = b64u(
		JSON.stringify({
			iss: issuer,
			aud: clientId,
			sub: `e2e-user-${randomUUID()}`,
			iat: now,
			exp: now + 3600,
			email: 'e2e@example.com',
			name: 'E2E User',
			organization,
		}),
	);
	const input = `${header}.${payload}`;
	const signature = createSign('RSA-SHA256').update(input).sign(privatePem, 'base64url');

	return `${input}.${signature}`;
}

function json(res, body) {
	res.writeHead(200, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

createServer((req, res) => {
	const parsed = new URL(req.url, issuer);

	switch (parsed.pathname) {
		case '/.well-known/openid-configuration':
			return json(res, {
				issuer,
				authorization_endpoint: `${issuer}/login/oauth/authorize`,
				token_endpoint: `${issuer}/api/login/oauth/access_token`,
				jwks_uri: `${issuer}/api/certs`,
				id_token_signing_alg_values_supported: ['RS256'],
			});
		case '/api/certs':
			return json(res, {
				keys: [{ kty: jwk.kty, alg: 'RS256', use: 'sig', kid: 'e2e-key', n: jwk.n, e: jwk.e }],
			});
		case '/login/oauth/authorize': {
			// A missing or malformed redirect_uri would throw inside the request
			// handler and kill the process; answer 400 instead so a buggy client
			// surfaces as a failed test, not a dead IdP.
			let redirect;

			try {
				redirect = new URL(parsed.searchParams.get('redirect_uri'));
			} catch {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				return res.end(JSON.stringify({ error: 'invalid_request', error_description: 'missing or invalid redirect_uri' }));
			}

			redirect.searchParams.set('code', 'e2e-code');
			redirect.searchParams.set('state', parsed.searchParams.get('state') ?? '');

			res.writeHead(302, { Location: redirect.toString() });

			return res.end();
		}
		case '/api/login/oauth/access_token':
			return json(res, {
				access_token: randomUUID(),
				token_type: 'Bearer',
				expires_in: 3600,
				id_token: signIDToken(),
			});
		default:
			res.writeHead(404);
			return res.end();
	}
}).listen(9401, '127.0.0.1', () => {
	console.log(`fake OIDC provider on ${issuer}`);
});
