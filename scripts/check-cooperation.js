const assert=require('node:assert/strict');
const {PartnerModel}=require('../build/v2/models/partner.model');
const {cooperationActive,fittingLocation}=require('../build/v2/services/cooperation.service');
const {resolveBookingPartner}=require('../build/v2/services/partner-referral.service');
const {reservationService}=require('../build/v2/services/reservation.service');
const {PublicCatalogueService}=require('../build/v2/services/public-catalogue.service');
const {fittingEmail}=require('../helpers/fittingEmail');
(async()=>{
 const exists=PartnerModel.exists;
 let active=false;
 PartnerModel.exists=async query=>{
  assert.equal(query.enabled,true);
  assert.equal(query.cooperationActive,true,'All new attribution requires explicit cooperation activation');
  return active?{_id:'blaze'}:null;
 };
 try{
  assert.equal(await cooperationActive(),false);
  assert.deepEqual(await fittingLocation(),{address:'Kytlická 862/2, Praha',placeName:'ANIRAK'});
  assert.equal(await resolveBookingPartner(),undefined);
  await assert.rejects(reservationService.createReservation({rentalMode:'studio'}),e=>e.code==='PRODUCT_NOT_RENTABLE');
  await assert.rejects(reservationService.createReservation({rentalMode:'external',partner:{partnerId:'blaze'}}),e=>e.code==='PRODUCT_NOT_RENTABLE');
  await assert.rejects(new PublicCatalogueService().calendar('id',{rentalMode:'studio',month:'2030-01'}),e=>e.code==='RENTAL_MODE_UNAVAILABLE');
  active=true;
  assert.deepEqual(await fittingLocation(),{address:'Plzeňská 782/112, 150 00 Praha',placeName:'Blaze Photostudio'});
  assert.deepEqual(await resolveBookingPartner(),{partnerId:'blaze',source:'anirak',version:1});
  active=false;
  const existing={number:'ZK-123456ABCDEF',expiresAt:'2030-01-01T13:00:00Z',date:'2030-01-01',time:'12:00',customer:{name:'Test',email:'test@example.test'},placeName:'Blaze Photostudio',address:'Plzeňská 782/112, 150 00 Praha'};
  assert.ok(fittingEmail(existing,'confirmed').text.includes('Místo: Blaze Photostudio'));
  const local={...existing,...await fittingLocation()};
  assert.ok(fittingEmail(local,'confirmed').text.includes('Místo: ANIRAK'));
  assert.ok(!fittingEmail(local,'confirmed').text.includes('Plzeňská'));
  console.log('PASS: inactive cooperation blocks studio/new partner bookings, switches address and referrals, preserves existing email snapshots');
 }finally{PartnerModel.exists=exists;}
})().catch(e=>{console.error(e);process.exitCode=1;});
