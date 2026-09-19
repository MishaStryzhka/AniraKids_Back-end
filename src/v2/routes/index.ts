import { getHealth } from '../controllers/health.controller';
import type { ExpressLike, RouterLike } from '../types/http';

export const createV2Router = (express: ExpressLike): RouterLike => {
  const router = express.Router();

  router.get('/health', getHealth);

  return router;
};
