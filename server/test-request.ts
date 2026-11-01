import supertest from 'supertest'

const TEST_ORIGIN = 'http://localhost:5173'
const testRequestMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])
type TestClient = ReturnType<typeof supertest>
type TestRequestMethod = (...args: unknown[]) => { set: (name: string, value: string) => unknown }

const withTrustedOrigin = (client: TestClient): TestClient => new Proxy(client, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver)
    if (typeof property !== 'string' || !testRequestMethods.has(property) || typeof value !== 'function') return value
    return (...args: unknown[]) => (value as TestRequestMethod).apply(target, args).set('Origin', TEST_ORIGIN)
  },
})

const request = Object.assign(
  (app: Parameters<typeof supertest>[0]) => withTrustedOrigin(supertest(app)),
  { agent: (app: Parameters<typeof supertest.agent>[0]) => withTrustedOrigin(supertest.agent(app)) },
)

export default request
