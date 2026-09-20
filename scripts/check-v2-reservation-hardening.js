const http = require('http');
const express = require('express');
const cors = require('cors');
const { Types } = require('mongoose');

const {
  ReservationV2Schema,
} = require('../build/v2/models');
const {
  createV2CorsOptions,
} = require('../build/v2/http/cors');
const {
  toPublicCreateReservationResponse,
} = require('../build/v2/http/reservation-response');
const {
  requireReservationIdempotencyKey,
  reservationApiHardeningReady,
} = require('../build/v2/middleware/idempotency.middleware');
const {
  reservationApiEnabled,
} = require('../build/v2/middleware/reservation.middleware');
const {
  IdempotencyConfigurationError,
  deriveIdempotentGuestAccessToken,
  hashIdempotencyKey,
  hashReservationFingerprint,
  isCanonicalUuidV4,
  requireGuestTokenSecret,
} = require('../build/v2/utils/idempotency');

const VALID_KEY = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_KEY = '550e8400-e29b-41d4-a716-446655440001';
const TEST_GUEST_SECRET =
  'phase-1g1-test-guest-token-secret-at-least-32-bytes';

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

const checkIdempotencyHeader = () => {
  assert(isCanonicalUuidV4(VALID_KEY), 'valid UUID v4 must be accepted');
  assert(!isCanonicalUuidV4(VALID_KEY.toUpperCase()), 'uppercase UUID must not be canonical');
  assert(!isCanonicalUuidV4('550e8400-e29b-11d4-a716-446655440000'), 'non-v4 UUID must fail');

  const missingResponse = createFakeResponse();
  requireReservationIdempotencyKey(
    { headers: {} },
    missingResponse,
    () => {
      throw new Error('missing idempotency key must not call next');
    }
  );
  assertEqual(missingResponse.statusCode, 400, 'missing key status');
  assertEqual(
    missingResponse.body.error.code,
    'IDEMPOTENCY_KEY_REQUIRED',
    'missing key code'
  );

  const invalidResponse = createFakeResponse();
  requireReservationIdempotencyKey(
    {
      headers: {
        'idempotency-key': 'not-a-uuid',
      },
    },
    invalidResponse,
    () => {
      throw new Error('invalid idempotency key must not call next');
    }
  );
  assertEqual(invalidResponse.statusCode, 400, 'invalid key status');
  assertEqual(
    invalidResponse.body.error.code,
    'INVALID_IDEMPOTENCY_KEY',
    'invalid key code'
  );

  let nextCount = 0;
  const request = {
    headers: {
      'idempotency-key': VALID_KEY,
    },
  };
  requireReservationIdempotencyKey(
    request,
    createFakeResponse(),
    () => {
      nextCount += 1;
    }
  );
  assertEqual(nextCount, 1, 'valid idempotency key next count');
  assertEqual(
    request.reservationIdempotencyKey,
    VALID_KEY,
    'validated key must be transiently available in request context'
  );
};

const checkHashesAndFingerprint = () => {
  const firstHash = hashIdempotencyKey(VALID_KEY);
  const secondHash = hashIdempotencyKey(VALID_KEY);

  assertEqual(firstHash, secondHash, 'idempotency key hash stability');
  assertEqual(firstHash.length, 64, 'idempotency key SHA-256 length');
  assert(firstHash !== VALID_KEY, 'raw key must differ from stored hash');

  const base = {
    productId: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    variantId: 'BBBBBBBBBBBBBBBBBBBBBBBB',
    rentalMode: 'external',
    startDate: '2027-10-10',
    endDate: '2027-10-12',
    customer: {
      firstName: '  Anna ',
      lastName: ' Nováková ',
      email: ' ANNA@EXAMPLE.CZ ',
      phone: ' +420 777 123 456 ',
    },
    notes: '  Prosím zavolat.  ',
  };

  const normalizedEquivalent = {
    ...base,
    productId: base.productId.toLowerCase(),
    variantId: base.variantId.toLowerCase(),
    customer: {
      firstName: 'Anna',
      lastName: 'Nováková',
      email: 'anna@example.cz',
      phone: '+420 777 123 456',
    },
    notes: 'Prosím zavolat.',
  };

  const baseHash = hashReservationFingerprint(base);
  const equivalentHash =
    hashReservationFingerprint(normalizedEquivalent);

  assertEqual(
    baseHash,
    equivalentHash,
    'semantic normalization must produce stable fingerprint'
  );

  assert(
    hashReservationFingerprint({
      ...normalizedEquivalent,
      endDate: '2027-10-13',
    }) !== baseHash,
    'different dates must change request fingerprint'
  );

  assert(
    hashReservationFingerprint({
      ...normalizedEquivalent,
      authenticatedUserId: new Types.ObjectId(),
    }) !== baseHash,
    'authenticated identity must change request fingerprint'
  );
};

const checkGuestTokenDerivation = () => {
  let configurationError;

  try {
    requireGuestTokenSecret('short');
  } catch (error) {
    configurationError = error;
  }

  assert(
    configurationError instanceof IdempotencyConfigurationError,
    'short guest token secret must fail safely'
  );

  const first = deriveIdempotentGuestAccessToken(
    VALID_KEY,
    TEST_GUEST_SECRET
  );
  const replay = deriveIdempotentGuestAccessToken(
    VALID_KEY,
    TEST_GUEST_SECRET
  );
  const different = deriveIdempotentGuestAccessToken(
    OTHER_KEY,
    TEST_GUEST_SECRET
  );

  assertEqual(
    first.rawToken,
    replay.rawToken,
    'same idempotency key must derive same guest token'
  );
  assertEqual(
    first.hash,
    replay.hash,
    'same idempotency key must derive same stored guest hash'
  );
  assert(
    first.rawToken !== different.rawToken,
    'different idempotency key must derive different guest token'
  );
  assert(
    first.rawToken !== first.hash,
    'raw guest token must differ from stored SHA-256 hash'
  );
};

const checkModelBoundary = () => {
  assert(
    ReservationV2Schema.path('idempotencyKey') === undefined,
    'raw idempotency key must not exist in ReservationV2'
  );
  assert(
    ReservationV2Schema.path('idempotencyKeyHash').options.select === false,
    'idempotencyKeyHash must be select:false'
  );
  assert(
    ReservationV2Schema.path('idempotencyRequestHash').options.select === false,
    'idempotencyRequestHash must be select:false'
  );
};

const checkPublicDto = () => {
  const result = toPublicCreateReservationResponse({
    reservation: {
      _id: new Types.ObjectId(),
      reservationNumber: 'AK-2027-ABC123',
      idempotencyKeyHash: 'a'.repeat(64),
      idempotencyRequestHash: 'b'.repeat(64),
      customerSnapshot: {
        firstName: 'Anna',
        lastName: 'Nováková',
        email: 'anna@example.cz',
        phone: '+420777123456',
      },
      items: [{
        productId: new Types.ObjectId(),
        variantId: new Types.ObjectId(),
        inventoryItemId: new Types.ObjectId(),
        productNameSnapshot: 'Dress',
        sizeSnapshot: '116',
        rentalPriceSnapshot: 800,
        depositSnapshot: 1000,
      }],
      rentalMode: 'external',
      startDate: new Date('2027-10-10T00:00:00.000Z'),
      endDate: new Date('2027-10-12T00:00:00.000Z'),
      status: 'pending',
      expiresAt: new Date('2027-10-01T12:00:00.000Z'),
      subtotal: 800,
      deposit: 1000,
      totalDue: 1800,
      fulfillmentMethod: 'pickup',
      paymentStatus: 'unpaid',
    },
    guestAccessToken: 'public-raw-token',
  });

  const serialized = JSON.stringify(result);

  assert(
    !serialized.includes('idempotencyKeyHash'),
    'public DTO must hide idempotencyKeyHash'
  );
  assert(
    !serialized.includes('idempotencyRequestHash'),
    'public DTO must hide idempotencyRequestHash'
  );
  assert(
    !serialized.includes('inventoryItemId'),
    'public DTO must continue hiding inventoryItemId'
  );
};

const callOrigin = (options, origin) =>
  new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(allowed === true);
    });
  });

const sendPreflight = (server, origin) =>
  new Promise((resolve, reject) => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      reject(new Error('CORS test server address missing'));
      return;
    }

    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/api/v2/reservations',
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers':
            'Content-Type,Authorization,Idempotency-Key',
        },
      },
      response => {
        response.resume();
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
          });
        });
      }
    );

    request.on('error', reject);
    request.end();
  });

const closeServer = server =>
  new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const checkCors = async () => {
  const options = createV2CorsOptions(
    'https://anirakids.cz, https://www.anirakids.cz'
  );

  assert(
    await callOrigin(options, 'https://anirakids.cz'),
    'allowlisted browser origin must be allowed'
  );
  assert(
    !(await callOrigin(options, 'https://evil.example')),
    'non-allowlisted browser origin must be blocked'
  );
  assert(
    await callOrigin(options, undefined),
    'request without Origin must be allowed'
  );

  const app = express();
  app.use('/api/v2', cors(options));
  app.options('/api/v2/reservations', (_request, response) => {
    response.status(204).end();
  });

  const server = await new Promise(resolve => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });

  try {
    const allowed = await sendPreflight(
      server,
      'https://anirakids.cz'
    );

    assertEqual(allowed.status, 204, 'allowed preflight status');
    assertEqual(
      allowed.headers['access-control-allow-origin'],
      'https://anirakids.cz',
      'allowed preflight origin header'
    );

    const methods =
      allowed.headers['access-control-allow-methods'] ?? '';
    const headers =
      allowed.headers['access-control-allow-headers'] ?? '';

    assert(methods.includes('POST'), 'preflight must allow POST');
    assert(methods.includes('OPTIONS'), 'preflight must allow OPTIONS');
    assert(headers.includes('Content-Type'), 'preflight Content-Type header');
    assert(headers.includes('Authorization'), 'preflight Authorization header');
    assert(headers.includes('Idempotency-Key'), 'preflight Idempotency-Key header');

    const blocked = await sendPreflight(
      server,
      'https://evil.example'
    );

    assert(
      blocked.headers['access-control-allow-origin'] === undefined,
      'blocked origin must receive no CORS permission'
    );
  } finally {
    await closeServer(server);
  }
};

const checkFeatureFlagAndSecretGate = () => {
  const originalFlag = process.env.V2_RESERVATION_API_ENABLED;
  const originalSecret = process.env.V2_GUEST_TOKEN_SECRET;

  try {
    delete process.env.V2_RESERVATION_API_ENABLED;

    const disabled = createFakeResponse();
    reservationApiEnabled(
      { headers: {} },
      disabled,
      () => {
        throw new Error('disabled feature flag must not call next');
      }
    );

    assertEqual(disabled.statusCode, 503, 'disabled feature flag status');

    process.env.V2_RESERVATION_API_ENABLED = 'true';
    process.env.V2_GUEST_TOKEN_SECRET = 'short';

    const notReady = createFakeResponse();
    reservationApiHardeningReady(
      { headers: {} },
      notReady,
      () => {
        throw new Error('invalid guest secret must not call next');
      }
    );
    assertEqual(notReady.statusCode, 503, 'missing hardening config status');
    assertEqual(
      notReady.body.error.code,
      'RESERVATION_API_CONFIGURATION_ERROR',
      'missing hardening config code'
    );

    process.env.V2_GUEST_TOKEN_SECRET = TEST_GUEST_SECRET;

    let nextCount = 0;
    reservationApiHardeningReady(
      { headers: {} },
      createFakeResponse(),
      () => {
        nextCount += 1;
      }
    );
    assertEqual(nextCount, 1, 'valid guest secret must allow route');
  } finally {
    if (originalFlag === undefined) {
      delete process.env.V2_RESERVATION_API_ENABLED;
    } else {
      process.env.V2_RESERVATION_API_ENABLED = originalFlag;
    }

    if (originalSecret === undefined) {
      delete process.env.V2_GUEST_TOKEN_SECRET;
    } else {
      process.env.V2_GUEST_TOKEN_SECRET = originalSecret;
    }
  }
};

const main = async () => {
  checkIdempotencyHeader();
  checkHashesAndFingerprint();
  checkGuestTokenDerivation();
  checkModelBoundary();
  checkPublicDto();
  checkFeatureFlagAndSecretGate();
  await checkCors();

  console.log('Phase 1G.1 reservation hardening checks passed');
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
