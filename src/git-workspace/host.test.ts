/**
 * Trust-decision tests for the clone routes.
 *
 * The plugin routes bypass the web server's authenticated document layer, so
 * the loopback decision is the only gate between a local page and `git clone`
 * on this machine; it is reviewed here without a server.
 *
 * @module dsh-session-map/git-workspace/host.test
 */
import { describe, expect, it } from 'vitest'
import { isTrustedRequest } from './host'

/** The request shape the trust decision reads. */
type TrustRequest = Parameters<typeof isTrustedRequest>[0]

/**
 * Build one request stub.
 * @param options - peer address plus the two headers the check reads.
 * @returns a structurally valid request stub.
 */
function request(options: {
  readonly peer?: string
  readonly host?: string
  readonly origin?: string
}): TrustRequest {
  const headers: Record<string, string> = {}
  if (options.host !== undefined) headers['host'] = options.host
  if (options.origin !== undefined) headers['origin'] = options.origin
  return {
    headers,
    ...(options.peer === undefined ? {} : { socket: { remoteAddress: options.peer } }),
  } as unknown as TrustRequest
}

describe('isTrustedRequest', () => {
  it('accepts a loopback peer with a matching loopback Host and no Origin', () => {
    expect(isTrustedRequest(request({ peer: '127.0.0.1', host: '127.0.0.1:3080' }))).toBe(true)
    expect(isTrustedRequest(request({ peer: '::1', host: '[::1]:3080' }))).toBe(true)
    expect(isTrustedRequest(request({ peer: '::ffff:127.0.0.1', host: '127.0.0.1:3080' }))).toBe(true)
  })

  it('accepts a same-origin page request', () => {
    expect(isTrustedRequest(request({
      peer: '127.0.0.1',
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
    }))).toBe(true)
  })

  it('rejects a remote peer that spoofs a loopback Host header', () => {
    expect(isTrustedRequest(request({ peer: '192.168.1.9', host: '127.0.0.1:3080' }))).toBe(false)
    expect(isTrustedRequest(request({ peer: '10.0.0.5', host: 'localhost:3080' }))).toBe(false)
  })

  it('rejects a request with no peer information', () => {
    expect(isTrustedRequest(request({ host: '127.0.0.1:3080' }))).toBe(false)
  })

  it('rejects a loopback peer whose Host is not loopback', () => {
    expect(isTrustedRequest(request({ peer: '127.0.0.1', host: 'evil.example:3080' }))).toBe(false)
    expect(isTrustedRequest(request({ host: '127.0.0.1:3080' }))).toBe(false)
  })

  it('rejects a mismatched or malformed Origin', () => {
    expect(isTrustedRequest(request({
      peer: '127.0.0.1',
      host: '127.0.0.1:3080',
      origin: 'http://evil.example',
    }))).toBe(false)
    expect(isTrustedRequest(request({ peer: '127.0.0.1', host: '127.0.0.1:3080', origin: 'not a url' }))).toBe(false)
  })
})
