import type { HttpHandler } from '../types/http';

export const getHealth: HttpHandler = (_request, response) => {
  return response.status(200).json({
    status: 'ok',
    api: 'v2',
  });
};
