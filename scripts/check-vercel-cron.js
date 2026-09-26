const fs = require('fs');
const path = require('path');

const {
  createRunAbandonedOrdersCron,
  requireVercelCronAuthorization,
} = require('../cron/vercel-http');

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${expected}, received ${actual}`
    );
  }
};

const createFakeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return body;
  },
});

const checkAuthorization = () => {
  const originalSecret = process.env.CRON_SECRET;

  try {
    delete process.env.CRON_SECRET;

    const missingSecretResponse = createFakeResponse();
    let missingSecretNextCalled = false;

    requireVercelCronAuthorization(
      { headers: {} },
      missingSecretResponse,
      () => {
        missingSecretNextCalled = true;
      }
    );

    assertEqual(
      missingSecretResponse.statusCode,
      401,
      'missing CRON_SECRET must fail closed'
    );
    assert(
      !missingSecretNextCalled,
      'missing CRON_SECRET must not call next'
    );

    process.env.CRON_SECRET = 'test-cron-secret';

    const wrongSecretResponse = createFakeResponse();
    let wrongSecretNextCalled = false;

    requireVercelCronAuthorization(
      { headers: { authorization: 'Bearer wrong-secret' } },
      wrongSecretResponse,
      () => {
        wrongSecretNextCalled = true;
      }
    );

    assertEqual(
      wrongSecretResponse.statusCode,
      401,
      'wrong cron bearer must be rejected'
    );
    assert(
      !wrongSecretNextCalled,
      'wrong cron bearer must not call next'
    );

    const validResponse = createFakeResponse();
    let validNextCalled = false;

    requireVercelCronAuthorization(
      {
        headers: {
          authorization: 'Bearer test-cron-secret',
        },
      },
      validResponse,
      () => {
        validNextCalled = true;
      }
    );

    assert(
      validNextCalled,
      'valid cron bearer must call next'
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  }
};

const checkRunHandler = async () => {
  let taskCalls = 0;

  const handler = createRunAbandonedOrdersCron(async () => {
    taskCalls += 1;
    return 3;
  });

  const response = createFakeResponse();
  let forwardedError;

  await handler(
    {},
    response,
    error => {
      forwardedError = error;
    }
  );

  assertEqual(taskCalls, 1, 'cron task call count');
  assertEqual(response.statusCode, 200, 'cron success status');
  assertEqual(response.body.success, true, 'cron success body');
  assertEqual(response.body.updatedCount, 3, 'cron updated count');
  assert(!forwardedError, 'successful cron run must not forward error');

  const expectedError = new Error('test cron failure');
  const failingHandler = createRunAbandonedOrdersCron(async () => {
    throw expectedError;
  });
  const failingResponse = createFakeResponse();
  let actualError;

  await failingHandler(
    {},
    failingResponse,
    error => {
      actualError = error;
    }
  );

  assert(
    actualError === expectedError,
    'cron task failure must be forwarded to Express error handling'
  );
};

const checkVercelConfig = () => {
  const configPath = path.join(__dirname, '..', 'vercel.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const cron = config.crons?.find(
    item =>
      item.path === '/api/internal/cron/update-abandoned-orders'
  );

  assert(cron, 'Vercel abandoned-order cron must be configured');
  assertEqual(
    cron.schedule,
    '0 0 * * *',
    'Vercel abandoned-order cron schedule'
  );
};

const main = async () => {
  checkAuthorization();
  await checkRunHandler();
  checkVercelConfig();

  console.log('Vercel abandoned-order cron checks passed');
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
