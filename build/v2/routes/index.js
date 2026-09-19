"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createV2Router = void 0;
const health_controller_1 = require("../controllers/health.controller");
const createV2Router = (express) => {
    const router = express.Router();
    router.get('/health', health_controller_1.getHealth);
    return router;
};
exports.createV2Router = createV2Router;
