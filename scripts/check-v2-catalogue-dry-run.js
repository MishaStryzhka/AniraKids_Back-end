const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const LegacyProduct = require('../models/product');

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error('MONGODB_URI is required for catalogue dry-run');
}

const databaseName = decodeURIComponent(
  new URL(uri).pathname.replace(/^\//, '')
);

if (databaseName !== 'AniraKids') {
  throw new Error(
    `Refusing catalogue dry-run: expected database AniraKids, received ${databaseName || '<missing>'}`
  );
}

if (/(test|testing|ci|dev)/i.test(databaseName)) {
  throw new Error('Refusing catalogue dry-run against non-production database');
}

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const REPORT_DIR = path.resolve(process.cwd(), 'reports');
const JSON_REPORT_PATH = path.join(
  REPORT_DIR,
  'v2-catalogue-migration-dry-run.json'
);
const MARKDOWN_REPORT_PATH = path.join(
  REPORT_DIR,
  'v2-catalogue-migration-summary.md'
);

const KNOWN_MAPPED_OR_REVIEWED_FIELDS = new Set([
  '_id',
  'name',
  'description',
  'brand',
  'brend',
  'category',
  'outfits',
  'familyLook',
  'size',
  'color',
  'age',
  'childSize',
  'rental',
  'sale',
  'deposit',
  'salePrice',
  'photos',
  'subject',
  'status',
]);

const REPORT_ONLY_FIELDS = new Set([
  'dailyRentalPrice',
  'hourlyRentalPrice',
  'rentalPeriods',
]);

const SYSTEM_FIELDS = new Set([
  'createdAt',
  'updatedAt',
]);

const EXPECTED_FUTURE_INDEXES = [
  {
    collection: 'v2_products',
    name: 'uniq_v2_product_slug',
    key: { slug: 1 },
    unique: true,
  },
  {
    collection: 'v2_variants',
    name: 'uniq_v2_variant_product_size',
    key: { productId: 1, size: 1 },
    unique: true,
  },
  {
    collection: 'v2_variants',
    name: 'uniq_v2_variant_sku',
    key: { sku: 1 },
    unique: true,
    partialFilterExpression: {
      sku: { $exists: true },
    },
  },
  {
    collection: 'v2_inventory_items',
    name: 'uniq_v2_inventory_internal_code',
    key: { internalCode: 1 },
    unique: true,
  },
  {
    collection: 'v2_inventory_items',
    name: 'idx_v2_inventory_variant_status',
    key: { variantId: 1, status: 1 },
  },
];

const isPlainObject = value =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

const isNonEmptyString = value =>
  typeof value === 'string' && value.trim().length > 0;

const hasValue = value =>
  value !== undefined &&
  value !== null &&
  !(typeof value === 'string' && value.trim().length === 0);

const isMoneyAmount = value =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= 0;

const normalizeComparableText = value =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs-CZ');

const normalizeDistributionKey = value => {
  if (value === undefined) return '<missing>';
  if (value === null) return '<null>';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : '<blank>';
  }

  return `<${Array.isArray(value) ? 'array' : typeof value}>`;
};

const increment = (record, key, amount = 1) => {
  record[key] = (record[key] ?? 0) + amount;
};

const compactObject = input =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );

const valueShape = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    const nested = [...new Set(value.map(valueShape))].sort();
    return `array<${nested.join('|') || 'empty'}>`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `object{${keys.join(',')}}`;
  }
  return typeof value;
};

const childSizeEntryType = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value)) return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  return typeof value;
};

const normalizeSizePrimitive = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const normalizeAgePrimitive = value => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const slugify = (name, legacyId) => {
  const normalizedName =
    typeof name === 'string'
      ? name
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .replace(/-{2,}/g, '-')
      : '';

  const base = normalizedName.slice(0, 160).replace(/-+$/g, '');

  if (base.length >= 2) {
    return {
      slug: base,
      usedFallback: false,
    };
  }

  return {
    slug: `produkt-${legacyId.slice(-8).toLowerCase()}`,
    usedFallback: true,
  };
};

const deterministicCollisionSlug = (baseSlug, legacyId) => {
  const suffix = legacyId.slice(-6).toLowerCase();
  const maxBaseLength = 160 - suffix.length - 1;
  const trimmedBase = baseSlug
    .slice(0, maxBaseLength)
    .replace(/-+$/g, '');

  return `${trimmedBase || 'produkt'}-${suffix}`;
};

const resolveBrand = product => {
  const brandValid = isNonEmptyString(product.brand);
  const brendValid = isNonEmptyString(product.brend);
  const brandPresent = hasValue(product.brand);
  const brendPresent = hasValue(product.brend);

  const result = {
    value: undefined,
    conflict: false,
    invalid: false,
    presence:
      brandPresent && brendPresent
        ? 'both'
        : brandPresent
          ? 'brandOnly'
          : brendPresent
            ? 'brendOnly'
            : 'neither',
  };

  if (
    (brandPresent && !brandValid) ||
    (brendPresent && !brendValid)
  ) {
    result.invalid = true;
  }

  if (brandValid && !brendValid) {
    result.value = product.brand.trim();
    return result;
  }

  if (!brandValid && brendValid) {
    result.value = product.brend.trim();
    return result;
  }

  if (brandValid && brendValid) {
    if (
      normalizeComparableText(product.brand) ===
      normalizeComparableText(product.brend)
    ) {
      result.value = product.brand.trim();
    } else {
      result.conflict = true;
    }
  }

  return result;
};

const resolveGender = product => {
  const signals = [];
  let babiesSignal = false;

  if (product.category === 'forWomen') signals.push('women');
  if (product.category === 'forMen') signals.push('men');

  if (product.outfits === 'for-girls') signals.push('girls');
  if (product.outfits === 'for-boys') signals.push('boys');
  if (product.outfits === 'for-babies') babiesSignal = true;

  const uniqueSignals = [...new Set(signals)];

  if (uniqueSignals.length === 1 && !babiesSignal) {
    return {
      gender: uniqueSignals[0],
      reviewRequired: false,
      reason: 'resolved',
      signals: uniqueSignals,
    };
  }

  if (uniqueSignals.length > 1) {
    return {
      gender: undefined,
      reviewRequired: true,
      reason: 'conflict',
      signals: uniqueSignals,
    };
  }

  if (babiesSignal) {
    return {
      gender: undefined,
      reviewRequired: true,
      reason: 'for-babies',
      signals: [],
    };
  }

  return {
    gender: undefined,
    reviewRequired: true,
    reason: 'no-safe-signal',
    signals: [],
  };
};

const resolveAgeTags = product => {
  const issues = [];
  const values = [];

  if (product.age === undefined || product.age === null) {
    return { values, issues };
  }

  if (!Array.isArray(product.age)) {
    issues.push('AGE_SHAPE_REVIEW_REQUIRED');
    return { values, issues };
  }

  for (const entry of product.age) {
    const normalized = normalizeAgePrimitive(entry);

    if (normalized !== undefined) {
      if (!values.includes(normalized)) values.push(normalized);
    } else {
      issues.push(`UNSUPPORTED_AGE_VALUE_${childSizeEntryType(entry).toUpperCase()}`);
    }
  }

  return {
    values,
    issues: [...new Set(issues)],
  };
};

const resolveVariantSizes = product => {
  const issues = [];
  const sizes = [];

  const addSize = value => {
    const normalized = normalizeSizePrimitive(value);

    if (normalized === undefined) {
      issues.push(
        `UNSUPPORTED_SIZE_VALUE_${childSizeEntryType(value).toUpperCase()}`
      );
      return;
    }

    if (!sizes.includes(normalized)) {
      sizes.push(normalized);
    }
  };

  if (product.childSize !== undefined && product.childSize !== null) {
    if (Array.isArray(product.childSize)) {
      for (const entry of product.childSize) addSize(entry);
    } else {
      issues.push(
        `UNSUPPORTED_CHILD_SIZE_SHAPE_${childSizeEntryType(product.childSize).toUpperCase()}`
      );
    }
  }

  if (product.size !== undefined && product.size !== null) {
    addSize(product.size);
  }

  if (sizes.length === 0) {
    issues.push('SIZE_REVIEW_REQUIRED');
  }

  return {
    sizes,
    issues: [...new Set(issues)],
  };
};

const resolvePhotos = (product, validName) => {
  const photos = [];
  const issues = [];
  let invalidEntries = 0;

  if (product.photos === undefined || product.photos === null) {
    return { photos, issues, invalidEntries };
  }

  if (!Array.isArray(product.photos)) {
    invalidEntries += 1;
    issues.push('INVALID_PHOTO_CONTAINER');
    return { photos, issues, invalidEntries };
  }

  for (const entry of product.photos) {
    if (
      !isPlainObject(entry) ||
      !isNonEmptyString(entry.path) ||
      !isNonEmptyString(entry.certificatePublicID)
    ) {
      invalidEntries += 1;
      continue;
    }

    photos.push(
      compactObject({
        url: entry.path.trim(),
        publicId: entry.certificatePublicID.trim(),
        alt: validName,
        generatedAltProposal: validName ? true : undefined,
      })
    );
  }

  if (invalidEntries > 0) {
    issues.push('INVALID_PHOTO_ENTRIES');
  }

  return { photos, issues, invalidEntries };
};

const rentalPeriodsCount = product => {
  if (!Array.isArray(product.rentalPeriods)) {
    return hasValue(product.rentalPeriods) ? 1 : 0;
  }

  return product.rentalPeriods.length;
};

const buildProductProposal = product => {
  const legacyProductId = String(product._id);
  const issues = [];
  const validName = isNonEmptyString(product.name)
    ? product.name.trim()
    : undefined;

  if (!validName || validName.length < 2 || validName.length > 120) {
    issues.push('NAME_REVIEW_REQUIRED');
  }

  const validDescription = isNonEmptyString(product.description)
    ? product.description.trim()
    : undefined;

  if (
    !validDescription ||
    validDescription.length > 5000
  ) {
    issues.push('DESCRIPTION_REVIEW_REQUIRED');
  }

  const slugResult = slugify(validName, legacyProductId);

  if (slugResult.usedFallback) {
    issues.push('SLUG_REVIEW_REQUIRED');
  }

  const brand = resolveBrand(product);

  if (brand.conflict) {
    issues.push('BRAND_CONFLICT');
  }

  if (brand.invalid) {
    issues.push('BRAND_VALUE_REVIEW_REQUIRED');
  }

  const gender = resolveGender(product);

  if (gender.reviewRequired) {
    issues.push('GENDER_REVIEW_REQUIRED');
  }

  issues.push('CATEGORY_REVIEW_REQUIRED');

  const ageTags = resolveAgeTags(product);
  issues.push(...ageTags.issues);

  const variants = resolveVariantSizes(product);
  issues.push(...variants.issues);

  const photos = resolvePhotos(product, validName);
  issues.push(...photos.issues);

  const rentalEnabled = product.rental === true;
  const saleEnabled = product.sale === true;

  if (hasValue(product.rental) && typeof product.rental !== 'boolean') {
    issues.push('RENTAL_FLAG_REVIEW_REQUIRED');
  }

  if (hasValue(product.sale) && typeof product.sale !== 'boolean') {
    issues.push('SALE_FLAG_REVIEW_REQUIRED');
  }

  if (rentalEnabled) {
    issues.push('RENTAL_PRICE_REVIEW_REQUIRED');
  }

  let defaultDeposit;

  if (isMoneyAmount(product.deposit)) {
    defaultDeposit = product.deposit;
  } else if (rentalEnabled || hasValue(product.deposit)) {
    issues.push('DEPOSIT_REVIEW_REQUIRED');
  }

  let defaultSalePrice;

  if (saleEnabled) {
    if (isMoneyAmount(product.salePrice)) {
      defaultSalePrice = product.salePrice;
    } else {
      issues.push('SALE_PRICE_REVIEW_REQUIRED');
    }
  } else if (hasValue(product.salePrice) && !isMoneyAmount(product.salePrice)) {
    issues.push('SALE_PRICE_VALUE_INVALID');
  }

  const color = isNonEmptyString(product.color)
    ? product.color.trim()
    : undefined;

  if (hasValue(product.color) && !color) {
    issues.push('COLOR_REVIEW_REQUIRED');
  }

  const familyLookGroup = isNonEmptyString(product.familyLook)
    ? product.familyLook.trim()
    : undefined;

  if (hasValue(product.familyLook) && !familyLookGroup) {
    issues.push('FAMILY_LOOK_REVIEW_REQUIRED');
  }

  const periodsCount = rentalPeriodsCount(product);

  if (periodsCount > 0) {
    issues.push('HAS_LEGACY_RENTAL_PERIODS');
  }

  const uniqueIssues = [...new Set(issues)];

  return {
    legacyProductId,
    proposedProduct: compactObject({
      name: validName,
      slug: slugResult.slug,
      description: validDescription,
      category: undefined,
      gender: gender.gender,
      color,
      occasion: [],
      ageTags: ageTags.values,
      brand: brand.value,
      familyLookGroup,
      rentalEnabled,
      saleEnabled,
      rentalPrices: undefined,
      defaultSalePrice,
      defaultDeposit,
      photos: photos.photos,
      status: 'draft',
    }),
    suggestedCategory: null,
    proposedVariants: variants.sizes.map(size => ({
      size,
      physicalInventory: {
        confirmedQuantity: null,
        confirmedInternalCodes: [],
      },
    })),
    legacyReference: compactObject({
      dailyRentalPrice: product.dailyRentalPrice,
      hourlyRentalPrice: product.hourlyRentalPrice,
      subject: product.subject,
      rentalPeriodsCount: periodsCount,
    }),
    review: {
      requiresCategoryReview: true,
      requiresGenderReview: gender.reviewRequired,
      genderSignalReason: gender.reason,
      requiresPricingReview: rentalEnabled,
      requiresSizeReview: variants.issues.some(issue =>
        issue.includes('SIZE')
      ),
      requiresSlugReview: slugResult.usedFallback,
      requiresBrandReview: brand.conflict || brand.invalid,
    },
    diagnostics: {
      invalidPhotoEntries: photos.invalidEntries,
      brandPresence: brand.presence,
      genderSignals: gender.signals,
    },
    issues: uniqueIssues,
    requiresManualReview: uniqueIssues.length > 0,
  };
};

const applySlugCollisionReview = proposals => {
  const bySlug = new Map();

  for (const proposal of proposals) {
    const slug = proposal.proposedProduct.slug;
    const current = bySlug.get(slug) ?? [];
    current.push(proposal);
    bySlug.set(slug, current);
  }

  const collisions = [];

  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;

    collisions.push({
      slug,
      legacyProductIds: group.map(item => item.legacyProductId),
      productCount: group.length,
    });

    for (const proposal of group) {
      proposal.proposedProduct.slug = deterministicCollisionSlug(
        slug,
        proposal.legacyProductId
      );
      proposal.review.requiresSlugReview = true;
      proposal.issues = [
        ...new Set([...proposal.issues, 'SLUG_COLLISION']),
      ];
      proposal.requiresManualReview = true;
    }
  }

  return collisions;
};

const buildMarkdown = manifest => {
  const summary = manifest.summary;
  const categoryLines = Object.entries(summary.categoryDistribution)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => '- `' + key + '`: ' + value)
    .join('\n');

  const genderLines = Object.entries(summary.genderSignalDistribution)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => '- `' + key + '`: ' + value)
    .join('\n');

  const childShapeLines = Object.entries(summary.childSizeEntryTypes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => '- `' + key + '`: ' + value)
    .join('\n');

  const unmappedLines = manifest.unmappedLegacyFields.length
    ? manifest.unmappedLegacyFields
        .map(field => '- `' + field + '`')
        .join('\n')
    : '- none discovered';

  const indexLines = manifest.expectedFutureIndexes
    .map(index => '- `' + index.collection + '.' + index.name + '`')
    .join('\n');

  return [
    '# AniraKids v2 Catalogue Migration Dry-Run',
    '',
    'Generated: ' + manifest.generatedAt + '  ',
    'Database: ' + manifest.databaseName + '  ',
    'Mode: **READ-ONLY / NO MIGRATION**',
    '',
    '## Summary',
    '',
    '- Total legacy products: **' + summary.totalLegacyProducts + '**',
    '- Active / inactive: **' + summary.activeLegacyProducts + ' / ' + summary.inactiveLegacyProducts + '**',
    '- Rental products: **' + summary.rentalProducts + '**',
    '- Sale products: **' + summary.saleProducts + '**',
    '- Rental + sale: **' + summary.rentalAndSaleProducts + '**',
    '- Cleanly mappable without manual review: **' + summary.cleanlyMappableProducts + '**',
    '- Require category review: **' + summary.productsRequiringCategoryReview + '**',
    '- Require gender review: **' + summary.productsRequiringGenderReview + '**',
    '- Require rental price review: **' + summary.productsRequiringRentalPriceReview + '**',
    '- Require size review: **' + summary.productsRequiringSizeReview + '**',
    '- Brand conflicts: **' + summary.brandConflicts + '**',
    '- Slug collision groups: **' + summary.slugCollisionGroups + '**',
    '- Invalid photo entries: **' + summary.invalidPhotoEntries + '**',
    '- Products with legacy rental periods: **' + summary.productsWithLegacyRentalPeriods + '**',
    '- Proposed ProductV2 drafts: **' + summary.proposedProductDrafts + '**',
    '- Proposed VariantV2 sizes: **' + summary.proposedVariantCount + '**',
    '- InventoryItemV2 created/proposed: **0 / 0**',
    '',
    '## Legacy category distribution',
    '',
    categoryLines || '- none',
    '',
    '## Gender signal distribution',
    '',
    genderLines || '- none',
    '',
    '## childSize entry shapes',
    '',
    childShapeLines || '- none',
    '',
    'Representative structural shapes only:',
    '',
    '~~~json',
    JSON.stringify(summary.childSizeRepresentativeShapes, null, 2),
    '~~~',
    '',
    '## Brand field presence',
    '',
    '~~~json',
    JSON.stringify(summary.brandPresence, null, 2),
    '~~~',
    '',
    '## Size / photo / rental-period discovery',
    '',
    '- Products with childSize: **' + summary.productsWithChildSize + '**',
    '- Products with size: **' + summary.productsWithSize + '**',
    '- Products missing both: **' + summary.productsMissingBothSizeSources + '**',
    '- Products with photos: **' + summary.productsWithPhotos + '**',
    '- Products with malformed photo entries: **' + summary.productsWithMalformedPhotos + '**',
    '- Products with rentalPeriods: **' + summary.productsWithLegacyRentalPeriods + '**',
    '',
    '## Unmapped legacy fields',
    '',
    unmappedLines,
    '',
    'These fields are not copied into ProductV2 in Phase 1H.1.',
    '',
    '## Future controlled indexes — NOT created',
    '',
    indexLines,
    '',
    '## Safety',
    '',
    '- ProductV2 status proposals are always draft.',
    '- Legacy daily/hourly prices are reference-only and are never converted to studio/external flat prices.',
    '- Legacy rentalPeriods are reference-only and are not migrated to Reservations or AvailabilityBlocks.',
    '- Size proposals never imply physical quantity.',
    '- Every proposed variant has unresolved physical inventory: confirmedQuantity = null.',
    '- No ProductV2, VariantV2, InventoryItemV2, ReservationV2, index, migration, or seed write is performed.',
    '',
  ].join('\n');
};

const main = async () => {
  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
  });

  try {
    if (mongoose.connection.db.databaseName !== 'AniraKids') {
      throw new Error('Connected database name does not match AniraKids');
    }

    const db = mongoose.connection.db;
    const legacyCollectionName = LegacyProduct.collection.name;
    const legacyCollection = db.collection(legacyCollectionName);

    const collections = await db
      .listCollections({}, { nameOnly: true })
      .toArray();
    const collectionNames = new Set(collections.map(item => item.name));

    if (!collectionNames.has(legacyCollectionName)) {
      throw new Error(
        `Legacy Product collection is missing: ${legacyCollectionName}`
      );
    }

    const keyRows = await legacyCollection
      .aggregate([
        {
          $project: {
            keys: {
              $map: {
                input: { $objectToArray: '$$ROOT' },
                as: 'entry',
                in: '$$entry.k',
              },
            },
          },
        },
        { $unwind: '$keys' },
        {
          $group: {
            _id: null,
            keys: { $addToSet: '$keys' },
          },
        },
      ])
      .toArray();

    const actualTopLevelFields = (keyRows[0]?.keys ?? []).sort();

    const legacyProducts = await legacyCollection
      .find(
        {},
        {
          projection: {
            owner: 0,
            pickupAddress: 0,
          },
        }
      )
      .sort({ _id: 1 })
      .toArray();

    const summary = {
      totalLegacyProducts: legacyProducts.length,
      activeLegacyProducts: 0,
      inactiveLegacyProducts: 0,
      otherLegacyStatusProducts: 0,
      rentalProducts: 0,
      saleProducts: 0,
      rentalAndSaleProducts: 0,
      categoryDistribution: {},
      outfitsDistribution: {},
      genderSignalDistribution: {},
      productsWithChildSize: 0,
      productsWithSize: 0,
      productsMissingBothSizeSources: 0,
      childSizeTopLevelShapes: {},
      childSizeEntryTypes: {},
      childSizeMixedProducts: 0,
      childSizeRepresentativeShapes: [],
      productsWithPhotos: 0,
      productsWithMalformedPhotos: 0,
      invalidPhotoEntries: 0,
      brandPresence: {
        brandOnly: 0,
        brendOnly: 0,
        both: 0,
        neither: 0,
      },
      brandConflicts: 0,
      productsWithLegacyRentalPeriods: 0,
      productsRequiringCategoryReview: 0,
      productsRequiringGenderReview: 0,
      productsRequiringRentalPriceReview: 0,
      productsRequiringSizeReview: 0,
      cleanlyMappableProducts: 0,
      slugCollisionGroups: 0,
      slugCollisionProducts: 0,
      proposedProductDrafts: 0,
      proposedVariantCount: 0,
    };

    const representativeShapeSet = new Set();
    const proposals = [];

    for (const product of legacyProducts) {
      if (product.status === 'active') {
        summary.activeLegacyProducts += 1;
      } else if (product.status === 'inactive') {
        summary.inactiveLegacyProducts += 1;
      } else {
        summary.otherLegacyStatusProducts += 1;
      }

      if (product.rental === true) summary.rentalProducts += 1;
      if (product.sale === true) summary.saleProducts += 1;
      if (product.rental === true && product.sale === true) {
        summary.rentalAndSaleProducts += 1;
      }

      increment(
        summary.categoryDistribution,
        normalizeDistributionKey(product.category)
      );
      increment(
        summary.outfitsDistribution,
        normalizeDistributionKey(product.outfits)
      );

      const hasChildSize = hasValue(product.childSize);
      const hasSize = hasValue(product.size);

      if (hasChildSize) summary.productsWithChildSize += 1;
      if (hasSize) summary.productsWithSize += 1;
      if (!hasChildSize && !hasSize) {
        summary.productsMissingBothSizeSources += 1;
      }

      const childTopLevelShape =
        product.childSize === undefined
          ? 'missing'
          : valueShape(product.childSize);

      increment(summary.childSizeTopLevelShapes, childTopLevelShape);

      if (Array.isArray(product.childSize)) {
        const entryTypes = new Set();

        for (const entry of product.childSize) {
          const type = childSizeEntryType(entry);
          entryTypes.add(type);
          increment(summary.childSizeEntryTypes, type);

          if (
            type === 'object' ||
            type === 'array' ||
            type === 'null'
          ) {
            representativeShapeSet.add(valueShape(entry));
          }
        }

        if (entryTypes.size > 1) {
          summary.childSizeMixedProducts += 1;
        }
      } else if (product.childSize !== undefined) {
        const type = childSizeEntryType(product.childSize);
        increment(summary.childSizeEntryTypes, type);
        representativeShapeSet.add(valueShape(product.childSize));
      }

      if (Array.isArray(product.photos) && product.photos.length > 0) {
        summary.productsWithPhotos += 1;
      } else if (hasValue(product.photos) && !Array.isArray(product.photos)) {
        summary.productsWithPhotos += 1;
      }

      if (rentalPeriodsCount(product) > 0) {
        summary.productsWithLegacyRentalPeriods += 1;
      }

      const proposal = buildProductProposal(product);

      increment(summary.brandPresence, proposal.diagnostics.brandPresence);

      if (proposal.issues.includes('BRAND_CONFLICT')) {
        summary.brandConflicts += 1;
      }

      if (proposal.diagnostics.invalidPhotoEntries > 0) {
        summary.productsWithMalformedPhotos += 1;
        summary.invalidPhotoEntries +=
          proposal.diagnostics.invalidPhotoEntries;
      }

      if (proposal.review.requiresCategoryReview) {
        summary.productsRequiringCategoryReview += 1;
      }

      if (proposal.review.requiresGenderReview) {
        summary.productsRequiringGenderReview += 1;
      }

      if (proposal.review.requiresPricingReview) {
        summary.productsRequiringRentalPriceReview += 1;
      }

      if (proposal.review.requiresSizeReview) {
        summary.productsRequiringSizeReview += 1;
      }

      increment(
        summary.genderSignalDistribution,
        proposal.proposedProduct.gender ??
          `review:${proposal.review.genderSignalReason}`
      );

      proposals.push(proposal);
    }

    const slugCollisions = applySlugCollisionReview(proposals);

    summary.slugCollisionGroups = slugCollisions.length;
    summary.slugCollisionProducts = slugCollisions.reduce(
      (sum, collision) => sum + collision.productCount,
      0
    );
    summary.proposedProductDrafts = proposals.length;
    summary.proposedVariantCount = proposals.reduce(
      (sum, proposal) => sum + proposal.proposedVariants.length,
      0
    );
    summary.cleanlyMappableProducts = proposals.filter(
      proposal => !proposal.requiresManualReview
    ).length;
    summary.childSizeRepresentativeShapes = [
      ...representativeShapeSet,
    ].sort();

    const unmappedLegacyFields = actualTopLevelFields
      .filter(
        field =>
          !KNOWN_MAPPED_OR_REVIEWED_FIELDS.has(field) &&
          !REPORT_ONLY_FIELDS.has(field) &&
          !SYSTEM_FIELDS.has(field)
      )
      .sort();

    const manifest = {
      generatedAt: new Date().toISOString(),
      databaseName,
      mode: 'READ_ONLY_DRY_RUN',
      legacyProductCollection: legacyCollectionName,
      summary,
      sourceDiscovery: {
        actualTopLevelFields,
        childSizeTopLevelShapes: summary.childSizeTopLevelShapes,
        childSizeEntryTypes: summary.childSizeEntryTypes,
        childSizeRepresentativeShapes:
          summary.childSizeRepresentativeShapes,
      },
      slugCollisions,
      unmappedLegacyFields,
      reportOnlyLegacyFields: [...REPORT_ONLY_FIELDS].sort(),
      expectedFutureIndexes: EXPECTED_FUTURE_INDEXES,
      currentV2CatalogueCollections: {
        v2_products: collectionNames.has('v2_products'),
        v2_variants: collectionNames.has('v2_variants'),
        v2_inventory_items: collectionNames.has(
          'v2_inventory_items'
        ),
      },
      products: proposals.map(proposal => {
        const {
          diagnostics: _diagnostics,
          ...publicProposal
        } = proposal;

        return publicProposal;
      }),
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      JSON_REPORT_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    fs.writeFileSync(
      MARKDOWN_REPORT_PATH,
      buildMarkdown(manifest),
      'utf8'
    );

    console.log(
      'PHASE_1H1_SUMMARY:',
      JSON.stringify(summary)
    );
    console.log(
      'PHASE_1H1_CATEGORY_DISTRIBUTION:',
      JSON.stringify(summary.categoryDistribution)
    );
    console.log(
      'PHASE_1H1_OUTFITS_DISTRIBUTION:',
      JSON.stringify(summary.outfitsDistribution)
    );
    console.log(
      'PHASE_1H1_GENDER_SIGNALS:',
      JSON.stringify(summary.genderSignalDistribution)
    );
    console.log(
      'PHASE_1H1_CHILD_SIZE_SHAPES:',
      JSON.stringify({
        topLevel: summary.childSizeTopLevelShapes,
        entries: summary.childSizeEntryTypes,
        mixedProducts: summary.childSizeMixedProducts,
        representativeShapes:
          summary.childSizeRepresentativeShapes,
      })
    );
    console.log(
      'PHASE_1H1_UNMAPPED_FIELDS:',
      JSON.stringify(unmappedLegacyFields)
    );
    console.log(
      'PHASE_1H1_V2_COLLECTIONS:',
      JSON.stringify(manifest.currentV2CatalogueCollections)
    );
    console.log(
      'PHASE_1H1_REPORT_PATHS:',
      JSON.stringify({
        json: path.relative(process.cwd(), JSON_REPORT_PATH),
        markdown: path.relative(
          process.cwd(),
          MARKDOWN_REPORT_PATH
        ),
      })
    );
    console.log('Phase 1H.1 catalogue dry-run passed');
  } finally {
    await mongoose.disconnect();
  }
};

main().catch(async error => {
  console.error(error.message);

  try {
    await mongoose.disconnect();
  } catch (_disconnectError) {
    // Preserve the original read-only failure.
  }

  process.exitCode = 1;
});
