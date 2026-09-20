import type {
  AvailabilityBlockReason,
  InventoryCondition,
  InventoryItemStatus,
} from '../types/domain';

export type InventoryAvailabilityAdminErrorCode =
  | 'INVENTORY_ITEM_NOT_FOUND'
  | 'INVALID_INVENTORY_TRANSITION'
  | 'INVENTORY_HAS_CURRENT_OR_FUTURE_RESERVATION'
  | 'DAMAGED_ITEM_REQUIRES_MAINTENANCE'
  | 'DAMAGED_ITEM_CANNOT_BE_ACTIVATED'
  | 'AVAILABILITY_BLOCK_NOT_FOUND'
  | 'AVAILABILITY_BLOCK_CONFLICT'
  | 'INVENTORY_ITEM_NOT_ACTIVE'
  | 'INVALID_DATE'
  | 'PAST_BLOCK_DATE';

export class InventoryAvailabilityAdminError extends Error {
  constructor(
    public readonly code: InventoryAvailabilityAdminErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'InventoryAvailabilityAdminError';
  }
}

export type InventoryLifecycleTargetStatus =
  | 'active'
  | 'maintenance'
  | 'retired';

export interface InventoryLifecycleSnapshot {
  status: InventoryItemStatus;
  condition: InventoryCondition;
}

export interface CreateAvailabilityBlockAdminInput {
  startDate: string;
  endDate: string;
  reason: AvailabilityBlockReason;
  notes?: string;
}

export interface ListAvailabilityBlocksAdminOptions {
  from?: string;
  to?: string;
  now?: Date;
}

export interface InventoryLifecycleOptions {
  now?: Date;
}
