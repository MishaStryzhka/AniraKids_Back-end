export interface ProductMediaSignedUploadParams {
  timestamp: number;
  folder: string;
  public_id: string;
  overwrite: false;
  allowed_formats: string;
}

export interface ProductMediaSignedUpload {
  cloudName: string;
  apiKey: string;
  signature: string;
  resourceType: 'image';
  params: ProductMediaSignedUploadParams;
}

export interface VerifiedProductMediaAsset {
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

export interface ProductMediaGateway {
  getProductFolder(productId: string): string;
  createSignedUploadRequest(productId: string): ProductMediaSignedUpload;
  verifyUploadedImage(publicId: string): Promise<VerifiedProductMediaAsset>;
  destroyImage(publicId: string): Promise<void>;
}

export class ProductMediaGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMediaGatewayError';
  }
}
