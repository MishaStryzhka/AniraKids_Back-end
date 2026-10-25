import {PartnerModel} from '../models/partner.model';
export const ANIRAK_ADDRESS = 'Kytlická 862/2, Praha';
export const BLAZE_ADDRESS = 'Plzeňská 782/112, 150 00 Praha';
export async function cooperationActive(): Promise<boolean> {
  return Boolean(await PartnerModel.exists({_id:'blaze', enabled:true, cooperationActive:true}));
}
export async function fittingLocation() {
  const active = await cooperationActive();
  return {address:active ? BLAZE_ADDRESS : ANIRAK_ADDRESS, placeName:active ? 'Blaze Photostudio' : 'ANIRAK'};
}
