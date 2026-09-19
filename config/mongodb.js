const mongoose = require('mongoose');

let connectionPromise = null;

mongoose.set('strictQuery', true);

const getMongoUri = () => {
  const uri = process.env.MONGODB_URI || process.env.DB_HOST;

  if (!uri) {
    throw new Error(
      'MongoDB connection is not configured. Set MONGODB_URI or legacy DB_HOST.'
    );
  }

  return uri;
};

const getMongoTopologyDiagnostics = async connection => {
  try {
    const hello = await connection.db.admin().command({ hello: 1 });

    if (hello?.msg === 'isdbgrid') {
      return {
        topology: 'sharded',
        setName: null,
        transactionsSupported: true,
      };
    }

    if (hello?.setName) {
      return {
        topology: 'replicaSet',
        setName: hello.setName,
        transactionsSupported: true,
      };
    }

    return {
      topology: 'standalone',
      setName: null,
      transactionsSupported: false,
    };
  } catch (error) {
    return {
      topology: 'unknown',
      setName: null,
      transactionsSupported: false,
    };
  }
};

const connectMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    const mongoUri = getMongoUri();

    connectionPromise = mongoose
      .connect(mongoUri)
      .then(async () => {
        console.log('Database connection successful');

        const topology = await getMongoTopologyDiagnostics(mongoose.connection);
        console.log('MongoDB topology diagnostics:', topology);

        return mongoose.connection;
      })
      .finally(() => {
        connectionPromise = null;
      });
  }

  return connectionPromise;
};

module.exports = {
  connectMongo,
  getMongoUri,
  getMongoTopologyDiagnostics,
};
