/**
 * OpenAPI 3.1 specification for the OpenBrowserGrid REST API.
 * Served as JSON at GET /openapi.json.
 */

export function getOpenApiSpec(port: number): object {
  const serverUrl = `http://localhost:${port}`;
  return {
    openapi: '3.1.0',
    info: {
      title: 'OpenBrowserGrid API',
      version: '0.1.0',
      description:
        'Self-hosted cloud browser infrastructure for AI agents and automation. ' +
        'Open-source alternative to Browserbase, Browserless, and Steel.',
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      contact: { url: 'https://github.com/Abhaii11/open-browsergrid' },
    },
    servers: [{ url: serverUrl, description: 'Local server' }],
    tags: [
      { name: 'health', description: 'Health and telemetry' },
      { name: 'sessions', description: 'Browser session lifecycle' },
      { name: 'profiles', description: 'Persistent browser profiles' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
      schemas: {
        GridStats: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            version: { type: 'string', example: '0.1.0' },
            activeSessions: { type: 'integer' },
            launchingSessions: { type: 'integer' },
            queuedRequests: { type: 'integer' },
            maxSessions: { type: 'integer' },
            uptime: { type: 'number', description: 'Process uptime in seconds' },
          },
        },
        SessionSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            profileId: { type: 'string' },
            persistent: { type: 'boolean' },
            createdAt: { type: 'integer', description: 'Unix ms timestamp' },
            uptimeSeconds: { type: 'integer' },
            timeoutMs: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['launching', 'ready', 'active', 'closing', 'closed'],
            },
            url: { type: 'string' },
            title: { type: 'string' },
            memoryMb: { type: 'number' },
            hasClient: { type: 'boolean' },
            metadata: { type: 'object', additionalProperties: { type: 'string' } },
            stealth: {
              type: 'object',
              properties: {
                preset: { type: 'string' },
                locale: { type: 'string' },
                timezone: { type: 'string' },
                webglRenderer: { type: 'string' },
              },
            },
            metrics: {
              type: 'object',
              properties: {
                messagesProxied: { type: 'integer' },
                framesReceived: { type: 'integer' },
              },
            },
          },
        },
        CreateSessionRequest: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Optional named session ID [a-zA-Z0-9_-]' },
            profileId: { type: 'string', description: 'Attach a persistent browser profile' },
            timeoutMs: { type: 'integer', minimum: 1000, description: 'Session idle timeout' },
            metadata: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Up to 20 user-defined key-value tags',
            },
            stealth: {
              type: 'object',
              properties: {
                preset: { type: 'string', enum: ['auto', 'macos', 'windows', 'linux'] },
                userAgent: { type: 'string' },
                locale: { type: 'string' },
                timezone: { type: 'string' },
                seed: { type: 'integer', minimum: 0 },
              },
            },
          },
        },
        ExecuteRequest: {
          type: 'object',
          required: ['method'],
          properties: {
            method: { type: 'string', description: 'CDP method, e.g. "Runtime.evaluate"' },
            params: { type: 'object', description: 'CDP method parameters' },
            timeoutMs: {
              type: 'integer',
              minimum: 100,
              maximum: 30000,
              description: 'Command timeout in ms (default 10000)',
            },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
        ProfileSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            path: { type: 'string' },
            inUse: { type: 'boolean' },
            updatedAt: { type: 'integer', description: 'Unix ms timestamp' },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['health'],
          summary: 'Health check and pool telemetry',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/GridStats' } },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['health'],
          summary: 'OpenAPI specification (this document)',
          responses: {
            '200': {
              description: 'OpenAPI 3.1 JSON spec',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/api/sessions': {
        get: {
          tags: ['sessions'],
          summary: 'List all active sessions',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': {
              description: 'Session list',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/SessionSummary' } },
                },
              },
            },
          },
        },
        post: {
          tags: ['sessions'],
          summary: 'Create a new browser session',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateSessionRequest' } },
            },
          },
          responses: {
            '201': {
              description: 'Session created',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SessionSummary' } },
              },
            },
            '400': {
              description: 'Bad request',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '409': {
              description: 'Profile in use',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '429': {
              description: 'Queue full',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '503': {
              description: 'Queue timeout',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/sessions/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          tags: ['sessions'],
          summary: 'Get session detail',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': {
              description: 'Session detail',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SessionSummary' } },
              },
            },
            '404': {
              description: 'Not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          tags: ['sessions'],
          summary: 'Close and terminate a session',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': { description: 'Session closed' },
            '404': {
              description: 'Not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/sessions/{id}/screenshot': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          tags: ['sessions'],
          summary: 'Capture a PNG screenshot of the current page',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': {
              description: 'PNG image',
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
            },
            '404': {
              description: 'Session not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '503': {
              description: 'Session not ready',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/sessions/{id}/execute': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          tags: ['sessions'],
          summary: 'Execute an arbitrary CDP command against the session',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ExecuteRequest' } },
            },
          },
          responses: {
            '200': {
              description: 'CDP result',
              content: {
                'application/json': { schema: { type: 'object', properties: { result: {} } } },
              },
            },
            '400': {
              description: 'Bad request',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '404': {
              description: 'Session not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '503': {
              description: 'Session not ready',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/profiles': {
        get: {
          tags: ['profiles'],
          summary: 'List persistent browser profiles',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': {
              description: 'Profile list',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/ProfileSummary' } },
                },
              },
            },
          },
        },
      },
      '/api/profiles/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        delete: {
          tags: ['profiles'],
          summary: 'Delete a persistent browser profile',
          security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
          responses: {
            '200': { description: 'Profile deleted' },
            '404': {
              description: 'Not found',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
            '409': {
              description: 'Profile in use',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
    },
  };
}
