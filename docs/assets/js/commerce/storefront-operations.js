const MONEY_FIELDS = `
    amount
    currencyCode
`;

const CART_FIELDS = `
    id
    checkoutUrl
    totalQuantity
    cost {
        subtotalAmount { ${MONEY_FIELDS} }
        totalAmount { ${MONEY_FIELDS} }
    }
    lines(first: 250) {
        nodes {
            id
            quantity
            ... on CartLine {
                instructions {
                    canRemove
                    canUpdateQuantity
                }
            }
            cost {
                totalAmount { ${MONEY_FIELDS} }
            }
            merchandise {
                ... on ProductVariant {
                    id
                    title
                    availableForSale
                    quantityRule {
                        minimum
                        maximum
                        increment
                    }
                    selectedOptions {
                        name
                        value
                    }
                    price { ${MONEY_FIELDS} }
                    image {
                        url
                        altText
                        width
                        height
                    }
                    product {
                        id
                        title
                    }
                }
            }
        }
    }
`;

const MUTATION_RESULT_FIELDS = `
    cart { ${CART_FIELDS} }
    userErrors {
        code
        field
        message
    }
    warnings {
        code
        message
        target
    }
`;

export const CART_QUERY = `#graphql
    query CbsCart($id: ID!) {
        cart(id: $id) { ${CART_FIELDS} }
    }
`;

export const CART_CREATE_MUTATION = `#graphql
    mutation CbsCartCreate($input: CartInput) {
        cartCreate(input: $input) { ${MUTATION_RESULT_FIELDS} }
    }
`;

export const CART_LINES_ADD_MUTATION = `#graphql
    mutation CbsCartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
        cartLinesAdd(cartId: $cartId, lines: $lines) { ${MUTATION_RESULT_FIELDS} }
    }
`;

export const CART_LINES_UPDATE_MUTATION = `#graphql
    mutation CbsCartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
        cartLinesUpdate(cartId: $cartId, lines: $lines) { ${MUTATION_RESULT_FIELDS} }
    }
`;

export const CART_LINES_REMOVE_MUTATION = `#graphql
    mutation CbsCartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
        cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { ${MUTATION_RESULT_FIELDS} }
    }
`;

export const PRODUCT_VARIANTS_QUERY = `#graphql
    query CbsProductVariants($id: ID!, $first: Int!, $after: String) {
        product(id: $id) {
            id
            title
            availableForSale
            variants(first: $first, after: $after) {
                nodes {
                    id
                    title
                    availableForSale
                    requiresComponents
                    selectedOptions {
                        name
                        value
                    }
                    quantityRule {
                        minimum
                        maximum
                        increment
                    }
                    price { ${MONEY_FIELDS} }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    }
`;
