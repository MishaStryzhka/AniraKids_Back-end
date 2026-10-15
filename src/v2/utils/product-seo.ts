// Keep this pure generator in sync with the storefront/admin preview.
export interface ProductSeoSource {
  name?: string; description?: string; category?: string; gender?: string;
  seo?: { title?: string; description?: string; noIndex?: boolean };
}
const clean = (value?: string) => (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const shorten = (value: string, limit: number) => {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd() + '…';
};
export function resolveProductSeo(product: ProductSeoSource) {
  const categories: Record<string, string> = { dress: 'šaty', suit: 'obleky', set: 'sety', accessory: 'doplňky', other: 'produkt' };
  const genders: Record<string, string> = { girls: 'Dívčí', boys: 'Chlapecké', women: 'Dámské', men: 'Pánské' };
  const category = categories[product.category ?? ''] ?? 'produkt';
  const adjective = category === 'produkt' ? '' : genders[product.gender ?? ''] ?? '';
  const label = adjective ? adjective + ' ' + category : category[0].toUpperCase() + category.slice(1);
  const name = clean(product.name);
  const identity = name && !/^(DET|DAM|PAN|DEK|HRA)\d+$/.test(name) ? name : [label, name].filter(Boolean).join(' ');
  const title = clean(product.seo?.title) || shorten(identity, 58) + ' | AniraKids';
  const description = clean(product.seo?.description) || shorten(clean(product.description) || `${identity}. Prohlédněte si fotografie a podrobnosti na AniraKids.`, 180);
  return { title, description, noIndex: product.seo?.noIndex === true };
}
