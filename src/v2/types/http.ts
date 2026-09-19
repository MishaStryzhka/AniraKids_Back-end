export interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

export type HttpHandler = (request: unknown, response: JsonResponse) => unknown;

export interface RouterLike {
  get(path: string, handler: HttpHandler): RouterLike;
}

export interface ExpressLike {
  Router(): RouterLike;
}
