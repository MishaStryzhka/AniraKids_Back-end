const assert = require('assert/strict');
const { resolveProductSeo } = require('../build/v2/utils/product-seo');
const { publicCatalogueService } = require('../build/v2/services/public-catalogue.service');
const { ProductV2Model, VariantV2Model } = require('../build/v2/models');
const { Types } = require('mongoose');
async function main() {
  const product = { _id: new Types.ObjectId(), name:'DET31',slug:'det31',category:'dress',gender:'girls',description:'Bílé slavnostní šaty.',photos:[],seo:{noIndex:false} };
  const expected = {title:'Dívčí šaty DET31 | AniraKids',description:'Bílé slavnostní šaty.',noIndex:false};
  assert.deepEqual(resolveProductSeo(product),expected);
  assert.equal(resolveProductSeo({...product,seo:{title:'Vlastní'}}).title,'Vlastní');
  assert.equal(resolveProductSeo({...product,seo:{title:' '}}).title,expected.title);
  assert.equal(resolveProductSeo({...product,name:'Sofie'}).title,'Sofie | AniraKids');
  const long=resolveProductSeo({...product,name:'Dlouhý název '.repeat(20),description:'Popis '.repeat(100)});
  assert.ok(long.title.length<=70 && long.description.length<=180);
  const findProduct=ProductV2Model.findOne, findVariants=VariantV2Model.find;
  try {
    ProductV2Model.findOne=()=>({select(projection){assert.ok(projection.split(' ').includes('seo'));return {exec:async()=>product}}});
    VariantV2Model.find=()=>({select(){return {sort(){return {exec:async()=>[]}}}}});
    const result=await publicCatalogueService.detail('det31');
    assert.deepEqual(result.product.seo,expected);
    product.seo={title:'Ruční titulek',description:'Ruční popis',noIndex:true};
    assert.deepEqual((await publicCatalogueService.detail('det31')).product.seo,product.seo);
  } finally {ProductV2Model.findOne=findProduct;VariantV2Model.find=findVariants;}
  console.log('Product SEO: generation, overrides, limits and public detail PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
