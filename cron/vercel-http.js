const updateAbandonedOrders = require('./js-abandoned');

const sendUnauthorized = response =>
  response.status(401).json({
    error: {
      code: 'CRON_UNAUTHORIZED',
      message: 'Cron authentication is required',
    },
  });

const requireVercelCronAuthorization = (request, response, next) => {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.authorization;

  if (!secret || authorization !== `Bearer ${secret}`) {
    return sendUnauthorized(response);
  }

  return next();
};

const createRunAbandonedOrdersCron = (
  task = updateAbandonedOrders
) => async (_request, response, next) => {
  try {
    const updatedCount = await task();

    return response.status(200).json({
      success: true,
      updatedCount,
    });
  } catch (error) {
    return next(error);
  }
};

const runAbandonedOrdersCron = createRunAbandonedOrdersCron();

module.exports = {
  createRunAbandonedOrdersCron,
  requireVercelCronAuthorization,
  runAbandonedOrdersCron,
};
