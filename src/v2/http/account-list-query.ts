/** All filters run before pagination; user search is always a literal string. */
export function accountListQuery(query:Record<string,unknown> | undefined, kind:'rental'|'fitting') {
 const q=query?.q??'', status=query?.status??'all', sort=query?.sort??'newest';
 if(typeof q!=='string'||q.length>100||typeof status!=='string'||!['all','active','finished','cancelled'].includes(status)||typeof sort!=='string'||!['newest','oldest','date_asc','date_desc'].includes(sort)) throw new Error('INVALID_ACCOUNT_QUERY');
 const filter:Record<string,unknown>={};
 if(q.trim()) {
  const literal=q.trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  filter.$or=(kind==='rental'?['reservationNumber','items.productNameSnapshot']:['number','product.name']).map(field=>({[field]:{$regex:literal,$options:'i'}}));
 }
 if(status!=='all')filter.status={$in:status==='active'?(kind==='rental'?['pending','confirmed','prepared','rented']:['pending','review','confirmed']):status==='finished'?(kind==='rental'?['returned']:['completed']):['cancelled','expired']};
 const order:Record<string,1|-1>=sort==='oldest'?{createdAt:1,_id:1}:sort==='date_asc'?{[kind==='rental'?'startDate':'date']:1,_id:1}:sort==='date_desc'?{[kind==='rental'?'startDate':'date']:-1,_id:-1}:{createdAt:-1,_id:-1};
 return {filter,order};
}
