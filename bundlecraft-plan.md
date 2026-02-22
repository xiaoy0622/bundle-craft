# BundleCraft — Shopify Bundle App 开发计划

## 项目概述

BundleCraft 是一个 Shopify App，帮助商家将多个商品打包成 bundle 进行销售，提升 AOV（平均订单金额）。

- **App 名称**: BundleCraft (已在 Shopify Partners 创建，组织: AuroraI innolab PTY LTD)
- **技术栈**: Shopify React Router App (TypeScript) + Shopify Functions (Cart Transform)
- **目标**: 上架 Shopify App Store

---

## 实现进度

| Phase | 任务 | 状态 |
|-------|------|------|
| Phase 1 | 项目初始化 | ✅ 已完成 |
| Phase 2 | 数据库设计 (Bundle, BundleComponent, AppSettings) | ✅ 已完成 |
| Phase 3.1 | Dashboard 页面 — bundle 列表 + 统计 + 筛选 + 操作 | ✅ 已完成 |
| Phase 3.2 | 创建/编辑 Bundle 页面 + BundleForm 组件 | ✅ 已完成 |
| Phase 3.3 | 设置页面 | ✅ 已完成 |
| Phase 4 | Cart Transform Function (TypeScript, lineExpand) | ✅ 已完成 |
| Phase 4.5 | App Scopes (write_products, write_cart_transforms 等) | ✅ 已完成 |
| Phase 4.6 | Cart Transform 自动激活 + Metafield 定义创建 | ✅ 已完成 |
| Phase 5 | Theme App Extension (bundle-widget block + CSS + JS) | ✅ 已完成 |
| Phase 6 | Bundle CRUD 核心逻辑 (bundle.server.ts) | ✅ 已完成 |
| Phase 7 | 开发和调试 | 🔲 待完成 — 需在开发店铺实际测试 |
| Phase 8 | 上架准备 | 🔲 待完成 |

### 实现说明

- **技术栈调整**: 项目使用 React Router v7 (非 Remix)，UI 使用 Polaris Web Components (`<s-page>`, `<s-button>` 等)
- **Metafield 命名空间**: 使用 `custom` 命名空间 (遵循 Shopify 官方 bundle 教程)，而非计划中的 `$app:bundle-craft`
- **Cart Transform**: 使用 `lineExpand` 操作 (2025-07 API 版本)，Function 逻辑读取 `component_reference` 和 `component_quantities` metafields
- **产品创建**: 使用 `productCreate` + `productVariantsBulkUpdate` + `metafieldsSet` 多步流程，设置 `requiresComponents: true` 和 `claimOwnership: { bundles: true }`
- **产品发布**: 创建 bundle 产品后自动发布到 Online Store
- **组件合并**: BundleForm 整合了计划中的 ProductPicker、DiscountConfig、BundlePreview 功能
- **新增 AppSettings 模型**: 用于存储默认折扣类型、徽章文字、是否显示节省金额等全局设置

---

## Phase 1: 项目初始化

### 1.1 环境要求

```bash
# 确保 Node.js >= 20.19
node -v

# 初始化项目
shopify app init

# 选择:
# - Template: Remix
# - Language: TypeScript
# - Organization: AuroraI innolab PTY LTD
# - App name: bundle-craft
```

### 1.2 项目结构

```
bundle-craft/
├── app/                          # Remix app (Admin UI)
│   ├── routes/
│   │   ├── app._index.tsx        # Dashboard - bundle 列表 + 统计
│   │   ├── app.bundles.new.tsx   # 创建新 bundle
│   │   ├── app.bundles.$id.tsx   # 编辑 bundle
│   │   └── app.settings.tsx      # App 设置
│   ├── components/
│   │   ├── BundleForm.tsx        # Bundle 创建/编辑表单
│   │   ├── ProductPicker.tsx     # 商品选择器 (使用 Shopify ResourcePicker)
│   │   ├── DiscountConfig.tsx    # 折扣配置组件
│   │   └── BundlePreview.tsx     # Bundle 预览
│   └── models/
│       └── bundle.server.ts      # Bundle CRUD 操作
├── extensions/
│   ├── bundle-cart-transform/    # Shopify Function - Cart Transform
│   │   ├── src/
│   │   │   ├── run.ts            # Function 逻辑 (JS/TS)
│   │   │   └── run.graphql       # Input query
│   │   └── shopify.extension.toml
│   └── bundle-theme-ext/         # Theme App Extension
│       ├── blocks/
│       │   └── bundle-widget.liquid  # Bundle 展示 block
│       ├── assets/
│       │   ├── bundle-widget.js      # 前端交互逻辑
│       │   └── bundle-widget.css     # 样式
│       └── shopify.extension.toml
├── prisma/
│   └── schema.prisma             # 数据库模型
└── shopify.app.toml              # App 配置
```

---

## Phase 2: 数据库设计

### 2.1 Prisma Schema

在 `prisma/schema.prisma` 中定义以下模型:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
}

// Bundle 主表
model Bundle {
  id              String          @id @default(cuid())
  shop            String                              // 店铺域名
  title           String                              // Bundle 名称
  description     String?                             // 描述
  status          String          @default("active")  // active | draft | archived
  discountType    String          @default("percentage") // percentage | fixed_amount | fixed_price
  discountValue   Float           @default(0)         // 折扣值
  bundleType      String          @default("fixed")   // fixed | mix_match
  
  // Shopify 关联
  productId       String?                             // Bundle 父产品的 Shopify Product ID (GID)
  variantId       String?                             // Bundle 父产品的 Variant ID (GID)
  
  // 展示配置
  showOnProduct   Boolean         @default(true)      // 是否在产品页展示
  badgeText       String?                             // 徽章文字, 如 "Save 20%"
  
  components      BundleComponent[]
  
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([shop])
}

// Bundle 子组件（包含的产品）
model BundleComponent {
  id              String    @id @default(cuid())
  bundleId        String
  bundle          Bundle    @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  
  productId       String    // Shopify Product GID
  variantId       String    // Shopify Variant GID
  productTitle    String    // 缓存的产品名称
  variantTitle    String?   // 缓存的 variant 名称
  productImage    String?   // 缓存的产品图片 URL
  quantity        Int       @default(1)
  sortOrder       Int       @default(0)
  
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([bundleId])
}
```

### 2.2 初始化数据库

```bash
npx prisma migrate dev --name init
npx prisma generate
```

---

## Phase 3: Admin UI (Remix Routes)

使用 Shopify Polaris 组件库构建 Admin 界面。所有页面都在 Shopify Admin 内嵌显示。

### 3.1 Dashboard 页面 (`app/routes/app._index.tsx`)

功能:
- 显示所有 bundle 列表 (使用 Polaris `IndexTable`)
- 每个 bundle 显示: 标题、包含商品数、折扣、状态、创建日期
- "Create Bundle" 按钮跳转到创建页
- 顶部显示简单统计: 总 bundle 数、活跃 bundle 数
- 支持搜索和筛选 (按状态)
- 每行支持操作: 编辑、复制、归档、删除

### 3.2 创建/编辑 Bundle 页面 (`app/routes/app.bundles.new.tsx` 和 `app/routes/app.bundles.$id.tsx`)

表单字段:
1. **基本信息**
   - Bundle 标题 (必填)
   - 描述 (可选)
   - 状态: Active / Draft

2. **选择商品** (核心功能)
   - 使用 Shopify App Bridge 的 `ResourcePicker` 让商家选择产品
   - 选中后显示产品列表，每个产品可以:
     - 设置数量
     - 选择特定 variant
     - 拖拽排序
     - 移除
   - 显示产品图片和价格

3. **折扣配置**
   - 折扣类型: 百分比折扣 / 固定金额折扣 / 固定总价
   - 折扣值输入
   - 实时预览: 显示原价、折扣后价格、节省金额

4. **展示设置**
   - 是否在产品页展示 bundle widget
   - 自定义徽章文字 (如 "Save 20%", "Best Value")

5. **保存逻辑**
   - 保存到本地数据库
   - 通过 Shopify Admin API 创建/更新 bundle 父产品
   - 在父产品 variant 上设置 metafields (component_reference, component_quantities)
   - 激活 Cart Transform Function

### 3.3 设置页面 (`app/routes/app.settings.tsx`)

- 默认折扣类型
- Bundle widget 默认样式设置
- 显示/隐藏节省金额

---

## Phase 4: Shopify Function — Cart Transform

这是 bundle 功能的核心。当顾客将 bundle 产品加入购物车时，Cart Transform Function 将 bundle 展开为子组件。

### 4.1 生成 Extension

```bash
shopify app generate extension --type cart_transform --name bundle-cart-transform
```

### 4.2 配置 `shopify.extension.toml`

```toml
api_version = "2025-07"

[[extensions]]
name = "bundle-cart-transform"
handle = "bundle-cart-transform"
type = "function"

  [extensions.build]
  command = ""
  path = "dist/function.wasm"

  [[extensions.targeting]]
  target = "purchase.cart-transform.run"
  input_query = "src/run.graphql"
  export = "run"
```

### 4.3 Input Query (`src/run.graphql`)

```graphql
query RunInput {
  cart {
    lines {
      id
      quantity
      merchandise {
        ... on ProductVariant {
          id
          product {
            id
          }
          requiresComponents
          componentReference: metafield(
            namespace: "$app:bundle-craft"
            key: "component_reference"
          ) {
            value
          }
          componentQuantities: metafield(
            namespace: "$app:bundle-craft"
            key: "component_quantities"
          ) {
            value
          }
          componentPrices: metafield(
            namespace: "$app:bundle-craft"
            key: "component_prices"
          ) {
            value
          }
        }
      }
    }
  }
}
```

### 4.4 Function 逻辑 (`src/run.ts`)

核心逻辑:
1. 遍历购物车中的所有 line items
2. 检查每个 variant 是否有 `requiresComponents = true`
3. 如果是 bundle 产品，读取其 metafields 获取子组件信息
4. 返回 `expand` 操作，将 bundle 展开为子组件 (用于库存扣减、税费计算、物流重量)
5. 在前端展示上保持 bundle 的整体展示

```typescript
// 伪代码结构
export function run(input: RunInput): FunctionRunResult {
  const operations: CartTransformOperation[] = [];
  
  for (const line of input.cart.lines) {
    const variant = line.merchandise;
    
    if (variant.__typename === "ProductVariant" && variant.requiresComponents) {
      const componentRefs = JSON.parse(variant.componentReference?.value || "[]");
      const componentQtys = JSON.parse(variant.componentQuantities?.value || "[]");
      
      if (componentRefs.length > 0) {
        operations.push({
          expand: {
            cartLineId: line.id,
            expandedCartItems: componentRefs.map((ref: string, idx: number) => ({
              merchandiseId: ref,
              quantity: componentQtys[idx] || 1,
            })),
          },
        });
      }
    }
  }
  
  return { operations };
}
```

### 4.5 在 App 配置中添加 Scope

在 `shopify.app.toml` 中确保包含:

```toml
[access_scopes]
scopes = "write_products,read_products,write_cart_transforms,read_cart_transforms"
```

### 4.6 激活 Cart Transform

在 app 安装时，通过 GraphQL Admin API 调用 `cartTransformCreate` mutation:

```graphql
mutation {
  cartTransformCreate(
    functionHandle: "bundle-cart-transform"
    blockOnFailure: false
  ) {
    cartTransform {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

---

## Phase 5: Theme App Extension

让 bundle widget 显示在商家的店面产品页上。

### 5.1 生成 Extension

```bash
shopify app generate extension --type theme_app_extension --name bundle-theme-ext
```

### 5.2 Bundle Widget Block (`blocks/bundle-widget.liquid`)

```liquid
{% comment %}
  BundleCraft - Bundle Widget
  显示在产品页，展示当前产品可用的 bundle 优惠
{% endcomment %}

{% assign bundle_data = product.metafields.bundle-craft.bundle_config.value %}

{% if bundle_data %}
<div class="bundlecraft-widget" data-bundle-id="{{ bundle_data.id }}">
  <div class="bundlecraft-header">
    <span class="bundlecraft-badge">{{ block.settings.badge_text }}</span>
    <h3 class="bundlecraft-title">{{ bundle_data.title }}</h3>
  </div>
  
  <div class="bundlecraft-items">
    {% for item in bundle_data.components %}
    <div class="bundlecraft-item">
      <img src="{{ item.image }}" alt="{{ item.title }}" width="60" height="60" loading="lazy">
      <div class="bundlecraft-item-info">
        <span class="bundlecraft-item-title">{{ item.title }}</span>
        <span class="bundlecraft-item-qty">x{{ item.quantity }}</span>
      </div>
      <span class="bundlecraft-item-price">{{ item.price | money }}</span>
    </div>
    {% endfor %}
  </div>
  
  <div class="bundlecraft-pricing">
    <div class="bundlecraft-original-price">
      <s>{{ bundle_data.original_price | money }}</s>
    </div>
    <div class="bundlecraft-bundle-price">
      {{ bundle_data.bundle_price | money }}
    </div>
    <div class="bundlecraft-savings">
      Save {{ bundle_data.savings | money }}
    </div>
  </div>
  
  <button class="bundlecraft-add-to-cart" 
          data-variant-id="{{ bundle_data.variant_id }}"
          type="button">
    Add Bundle to Cart
  </button>
</div>
{% endif %}

{% schema %}
{
  "name": "BundleCraft Widget",
  "target": "section",
  "settings": [
    {
      "type": "text",
      "id": "badge_text",
      "label": "Badge Text",
      "default": "Bundle & Save"
    },
    {
      "type": "color",
      "id": "accent_color",
      "label": "Accent Color",
      "default": "#4CAF50"
    },
    {
      "type": "select",
      "id": "layout",
      "label": "Layout",
      "options": [
        { "value": "vertical", "label": "Vertical" },
        { "value": "horizontal", "label": "Horizontal" }
      ],
      "default": "vertical"
    }
  ]
}
{% endschema %}
```

### 5.3 前端 JS (`assets/bundle-widget.js`)

- 处理 "Add Bundle to Cart" 按钮点击
- 调用 Shopify Cart API (`/cart/add.js`) 添加 bundle 父产品到购物车
- 添加加载状态和成功/失败反馈
- 可选: 使用 Shopify Cart API 的 AJAX 方式避免页面刷新

### 5.4 CSS 样式 (`assets/bundle-widget.css`)

- 设计简洁现代的 bundle card 样式
- 使用 CSS 变量支持主题色自定义
- 响应式设计，适配移动端
- 节省金额使用醒目的颜色高亮

---

## Phase 6: 核心 API 逻辑 (Bundle CRUD)

### 6.1 创建 Bundle 的完整流程 (`app/models/bundle.server.ts`)

```typescript
// 1. 保存 bundle 到本地数据库
// 2. 通过 Admin API 创建 bundle 父产品
// 3. 在父产品 variant 上设置 metafields

async function createBundle(shop: string, admin: AdminApiContext, data: BundleInput) {
  // Step 1: 保存到数据库
  const bundle = await prisma.bundle.create({
    data: {
      shop,
      title: data.title,
      description: data.description,
      discountType: data.discountType,
      discountValue: data.discountValue,
      bundleType: data.bundleType,
      components: {
        create: data.components.map((comp, idx) => ({
          productId: comp.productId,
          variantId: comp.variantId,
          productTitle: comp.productTitle,
          variantTitle: comp.variantTitle,
          productImage: comp.productImage,
          quantity: comp.quantity,
          sortOrder: idx,
        })),
      },
    },
    include: { components: true },
  });

  // Step 2: 创建 Shopify 产品作为 bundle 父产品
  const productCreateResponse = await admin.graphql(`
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      input: {
        title: data.title,
        descriptionHtml: data.description,
        productType: "Bundle",
        tags: ["bundlecraft", "bundle"],
        status: data.status === "active" ? "ACTIVE" : "DRAFT",
      }
    }
  });

  // Step 3: 设置 variant metafields
  // 包括 component_reference 和 component_quantities
  // 使 Cart Transform Function 能够读取 bundle 组成
  
  // Step 4: 更新数据库，保存 Shopify productId 和 variantId
  
  return bundle;
}
```

### 6.2 关键 GraphQL Mutations

```graphql
# 创建产品
mutation productCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product { id }
    userErrors { field message }
  }
}

# 设置 variant metafields (bundle 组件信息)
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id }
    userErrors { field message }
  }
}

# 激活 Cart Transform
mutation cartTransformCreate($functionHandle: String!) {
  cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: false) {
    cartTransform { id }
    userErrors { field message }
  }
}
```

---

## Phase 7: 开发和调试

### 7.1 本地开发

```bash
# 启动开发服务器
shopify app dev

# 这会:
# 1. 启动 Remix dev server
# 2. 创建 Cloudflare tunnel
# 3. 在开发店铺安装 app
# 4. 自动部署 extensions
```

### 7.2 测试 Cart Transform Function

```bash
# 查看 function 日志
shopify app function run --path extensions/bundle-cart-transform

# 或使用 Shopify 的 function runner 进行本地测试
# 创建 test input JSON 模拟购物车数据
```

### 7.3 测试流程

1. 在开发店铺创建几个测试产品
2. 通过 app admin UI 创建一个 bundle
3. 在店面将 bundle 加入购物车
4. 验证购物车中 bundle 正确展开为子组件
5. 完成结账，验证库存正确扣减

---

## Phase 8: 上架准备

### 8.1 App Store Listing

- **App 名称**: BundleCraft - Product Bundles
- **Tagline**: Create product bundles to boost AOV with smart discounts
- **关键词**: bundle, product bundle, AOV, discount, mix and match, BOGO
- **定价策略**:
  - Free plan: 最多 3 个 bundle
  - Basic plan ($9.99/mo): 无限 bundle，基础分析
  - Pro plan ($29.99/mo): Mix & Match, A/B 测试, 高级分析

### 8.2 必要的 Compliance

- Privacy policy URL
- App icon (1200x1200px)
- 至少 3 张 screenshots
- Demo store URL
- 确保 app 符合 Shopify App Store 审核要求

### 8.3 部署

```bash
# 部署到 Shopify
shopify app deploy
```

---

## 开发优先级顺序

| 优先级 | 任务 | 预计时间 |
|--------|------|---------|
| P0 | 项目初始化 + 数据库 | 1 天 |
| P0 | Admin UI - Bundle CRUD | 2-3 天 |
| P0 | Cart Transform Function | 2 天 |
| P0 | Shopify 产品创建 + Metafields | 1-2 天 |
| P1 | Theme App Extension (Widget) | 2 天 |
| P1 | 折扣计算逻辑 | 1 天 |
| P2 | 设置页面 | 0.5 天 |
| P2 | 错误处理和边界情况 | 1 天 |
| P3 | App Store 上架准备 | 1-2 天 |

---

## 注意事项

1. **每个店铺只能有一个 Cart Transform Function** — 如果商家已装了其他 bundle app，会冲突
2. **lineUpdate 操作仅支持开发店或 Shopify Plus** — 初始版本使用 expand 操作即可
3. **库存同步** — bundle 可用数量取决于库存最少的子组件
4. **Metafield 命名空间** — 使用 app-reserved namespace `$app:bundle-craft`
5. **Shopify Functions 推荐用 Rust** — 但 JavaScript 也可以，初始版本可以用 JS/TS，后续性能优化再考虑 Rust
6. **API 版本** — 使用 2025-07 或更新版本
7. **测试** — 先在开发店铺充分测试，确保 bundle 展开、库存扣减、折扣计算都正确
