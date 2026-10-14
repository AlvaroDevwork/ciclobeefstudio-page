import { createProductOptionsService } from "../docs/assets/js/commerce/product-options.js";
import { PRODUCT_REGISTRY } from "../docs/assets/js/commerce/products.js";

const service = createProductOptionsService({ pageSize: 250 });
const products = [];

for (const registryProduct of PRODUCT_REGISTRY) {
    const product = await service.load(registryProduct);
    products.push({
        registryKey: product.registryKey,
        title: product.title,
        productId: product.productId,
        optionNames: product.optionNames,
        variantCount: product.variants.length,
        purchasableVariantCount: product.purchasableVariants.length,
        availableForSale: product.availableForSale,
        requiresComponentsCount: product.variants.filter(variant => variant.requiresComponents).length,
        purchaseMode: product.purchaseMode,
        variants: product.variants.map(variant => ({
            availableForSale: variant.availableForSale,
            requiresComponents: variant.requiresComponents,
            selectedOptions: variant.selectedOptions,
            quantityRule: variant.quantityRule,
            price: variant.price,
        })),
    });
}

const classifications = Object.fromEntries(
    [...new Set(products.map(product => product.purchaseMode))]
        .map(mode => [mode, products.filter(product => product.purchaseMode === mode).length]),
);

console.log(JSON.stringify({
    audited: products.length,
    classifications,
    products,
}, null, 2));
