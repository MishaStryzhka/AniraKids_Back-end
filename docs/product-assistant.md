# Photo-first product creation

New creation uses authenticated `/api/v2/admin/product-drafts` endpoints. Drafts are owned by the administrator and stay outside the catalogue. Cloudinary SIGN/COMPLETE verifies ownership, resource type, format, dimensions and 15 MiB size before a photo can reach AI or a saved product. At most ten confirmed images; AI uses the first five.

The first save freezes validated input and photos, assigns a counter-based code, and inserts the product using the draft ObjectId. Repeating save returns the existing product; input changes after an ambiguous save do not change that saved snapshot. Counters initialize above padded and unpadded legacy name/slug codes. Failed or competing saves can leave number gaps; numbers are never reused. New name compatibility values contain only the code. New code/URL cannot be edited. Old names and URLs stay unchanged.

Set `OPENAI_API_KEY` as a sensitive server environment variable in the backend Vercel project, Production only initially. Optional `OPENAI_PRODUCT_MODEL` overrides `gpt-5.6-terra`; choose a Responses-compatible vision model supporting structured outputs and low reasoning effort. Redeploy after changing environment variables. No browser key, no provider response logging. API billing is configured separately in the OpenAI project. Missing configuration returns a Czech manual-entry fallback.

Responses API uses `store:false`, strict JSON schema, an allowlisted palette/category/audience, high image detail, a 45-second timeout, 4,000 output-token cap and a one-minute per-draft cooldown. This is a proposal, never an automatic publication. Age is only suggested from a readable age label. The administrator reviews all fields.

Draft records and unconfirmed/removed assets are retained for recovery. Automated expiry/asset cleanup is not enabled in this release; operators must review abandoned drafts before deleting media, including checking saved products. Do not use a Mongo TTL index alone: that would lose the ownership manifest for cloud assets.

Verification: `NODE_ENV=test ASSISTANT_MONGOD_BINARY=/absolute/path/to/mongod node scripts/check-product-assistant.js`. The harness creates its own loopback process/database and stubs every AI/media operation; it never uses application database credentials. A real AI smoke test still requires the production API key and an administrator-selected photo.
