require('dotenv').config();

const app = require('./app');
const { connectMongo } = require('./config/mongodb');

const { PORT = 4000 } = process.env;

connectMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running. Use our API on port: ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  });
