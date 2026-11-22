# UptimeHQ Test Lab

A small, separate app with endpoints that fail on demand, for testing every kind of downtime UptimeHQ detects. It is served at `/testlab` on the same domain as UptimeHQ but runs in its own container, with no dependencies and no access to the database, Redis, secrets or the internet.

## Open it

Go to `https://<your-domain>/testlab/`. The password is generated on first start. Print it on the server, from the repository folder:

```bash
docker compose exec -T testlab cat /data/password
```

Pick a behaviour from an endpoint's dropdown and UptimeHQ shows it on that monitor's next check. **All down** and **All healthy** switch everything at once. **Custom response** lets you set the status, delay and body.

## Add the monitors to your account

Sign in to UptimeHQ once, then run this on the server with the email you sign in with:

```bash
docker compose exec -T testlab node src/monitors.js | docker compose exec -T api node dist/cli/importMonitors.js you@example.com
```

It creates 32 monitors and is safe to run again (existing names are skipped):

- **`Lab: …` (8, every 30 seconds):** the endpoints you control, one per endpoint and authentication type. They start healthy.
- **`Sim: …` (24, every 5 minutes):** one per failure type. They are always down, so **each sends one "down" email** when first checked. Add `--paused` to import everything paused and resume what you need.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/testlab/e/website`, `api`, `head` | Public website, JSON API and `HEAD` check, switched from the page |
| `/testlab/e/bearer`, `basic`, `api-key`, `headers`, `oauth` | Protected endpoints that require the credentials shown on the page |
| `/testlab/e/token` | OAuth2 client credentials token server, can be broken from the page |
| `/testlab/s/<scenario>` | Fixed scenarios that always behave the same |
| `/testlab/t/<failure>` | Token URLs that always fail |

## How each failure is produced

| Failure | Recorded as | How |
| --- | --- | --- |
| 400, 404, 405, 410, 429, 500, 502, 503, 504 | `HTTP_STATUS_FAILURE` | Returns that status |
| Redirect loop | `HTTP_STATUS_FAILURE` | Redirects to itself |
| 401 | `AUTHENTICATION_FAILED` | Returns 401 |
| 403 | `AUTHORIZATION_FAILED` | Returns 403 |
| No response | `TIMEOUT` | Holds the request for 35 seconds |
| Headers sent, body hangs | `TIMEOUT` | Sends a 200 and part of the body, then nothing |
| Connection never completes | `TIMEOUT` | Redirects to an address that never answers |
| Connection reset | `NETWORK_ERROR` | NGINX resets the TCP connection |
| Response cut off mid-body | `NETWORK_ERROR` | Promises 4 KB, sends 8 bytes, then closes |
| Connection refused | `NETWORK_ERROR` | Redirects to port 3389 of the same VM (open in GCP's default firewall, nothing listening) |
| DNS failure | `NETWORK_ERROR` | Redirects to a `.invalid` hostname |
| Host unreachable | `NETWORK_ERROR` | Redirects to an IPv6 address (containers have no IPv6 route) |
| TLS problem | `NETWORK_ERROR` | Redirects to `wrong.host.badssl.com` |
| Unsafe destination | `NETWORK_ERROR` | Redirects to a private address, which SSRF protection refuses |
| Token failures | `TOKEN_ACQUISITION_FAILED` | The token URL rejects the client, errors, redirects or returns no usable token |

Network failures are real: the checker follows the redirect and fails at that layer. If your firewall drops port 3389, "refused" is recorded as a timeout.

**Flapping** has no fixed result: it alternates each minute and sends an email on every change.

## Security

- Reading or changing the switches needs the password.
- NGINX removes cookies before requests reach the lab.
- Simulated responses are never HTML and are sandboxed by CSP.
- Redirects only go to fixed targets, so it is not an open redirect.
- The request log holds no header values, query strings, bodies or IP addresses.

## Development

```bash
cd testlab && npm test
```

```bash
cd testlab && npm start
```

`npm start` serves http://localhost:8090/testlab/ with the password in `testlab/data/password`. Connection resets need NGINX, so they only work through Docker Compose.
