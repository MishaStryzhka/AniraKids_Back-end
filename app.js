const express = require('express');
const logger = require('morgan');
const cors = require('cors');

require('dotenv').config();


// const passport = require('passport');
// const session = require('express-session');

// const swaggerUi = require('swagger-ui-express');
// const swaggerDocument = require('./swagger.json');

const authRouter = require('./routes/api/auth');
const settingsRouter = require('./routes/api/settings');
const retiredMarketplace = require('./routes/retiredMarketplace');
const { createV2Router } = require('./build/v2/routes');
const { createV2CorsOptions } = require('./build/v2/http/cors');
const { connectMongo } = require('./config/mongodb');

const path = require('path');

const app = express();

const formatsLogger = app.get('env') === 'development' ? 'dev' : 'short';

app.use(logger(formatsLogger));

const legacyCors = cors();

app.use('/api/v2', cors(createV2CorsOptions()));
app.use((req, res, next) => {
  if (req.path === '/api/v2' || req.path.startsWith('/api/v2/')) {
    return next();
  }

  return legacyCors(req, res, next);
});

// Close retired routes before authentication, uploads or database access.
app.use(retiredMarketplace);
app.use(express.json());

// **********************************************************************

// app.set('view engine', 'ejs');

// app.get('/', (req, res) => {
//   res.render('index.ejs');
// });

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/index.html'));
});

app.use('/styles', express.static('public'));

// **********************************************************************

const ensureMongoConnection = async (req, res, next) => {
  try {
    await connectMongo();
    return next();
  } catch (error) {
    return next(error);
  }
};

app.use(
  '/api/v2',
  createV2Router(express, {
    ensureMongoConnection,
  })
);


app.use('/api/users', ensureMongoConnection, authRouter);
app.use('/api/settings', ensureMongoConnection, settingsRouter);

// app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const { status = 500, message = 'Server error' } = err;
  return res.status(status).json({ message });
});

module.exports = app;
