/* Рабочий локальный каталог, загруженный из API otabek.glasscenter.kg.
 * Каждый размер хранится как отдельная складская позиция, но интерфейс
 * группирует их в одну карточку исходного товара.
 * API не отдаёт количество и закупочную цену: исходный приход создаётся по
 * 1 шт. по опубликованной цене. */
(function () {
  const PRODUCTS = [
    {
      externalId: 7,
      name: 'Шуруповёрт',
      category: 'Без категории',
      photo: 'assets/products/otabek-7.jpg',
      createdAt: '2026-10-10T15:32:45.514245+06:00',
      sizes: [
        { id: 13, name: 'оргон 36в', price: 1100 },
        { id: 14, name: 'орта 48в', price: 1800 },
      ],
    },
    {
      externalId: 6,
      name: 'Монтажная коробка',
      category: 'Без категории',
      photo: 'assets/products/otabek-6.jpg',
      createdAt: '2026-10-10T15:26:46.842265+06:00',
      sizes: [
        { id: 19, name: '80х80', price: 50 },
        { id: 20, name: '10х100', price: 80 },
        { id: 21, name: '150х100', price: 120 },
      ],
    },
    {
      externalId: 3,
      name: 'Вытяжка',
      category: 'Вытяжка',
      photo: 'assets/products/otabek-3.jpg',
      createdAt: '2026-10-10T15:21:01.816191+06:00',
      sizes: [
        { id: 15, name: '100 м', price: 100 },
        { id: 16, name: '90лик', price: 120 },
      ],
    },
  ];

  function run() {
    E.S.user = 'Администратор';
    E._time = '2026-10-10T15:40:00+06:00';

    const supplier = E.saveCp({
      name: 'Отабек',
      note: 'Поставщик. Каталог загружен из otabek.glasscenter.kg',
      importCode: 'OTABEK',
    });

    const lines = [];
    PRODUCTS.forEach((source) => source.sizes.forEach((size) => {
      const product = E.saveProduct({
        name: source.name,
        variantName: size.name,
        category: source.category,
        unit: 'шт',
        purchasePrice: size.price,
        wholesalePrice: size.price,
        retailPrice: size.price,
        photo: source.photo,
        importCode: `OT-${source.externalId}-${size.id}`,
        externalProductId: source.externalId,
        externalSizeId: size.id,
        externalCreatedAt: source.createdAt,
      });
      lines.push({
        pid: product.id,
        qty: 1,
        price: size.price,
        wholesale: size.price,
        retail: size.price,
      });
    }));

    const receipt = E.newReceipt({
      cp: supplier.id,
      source: 'supplier',
      comment: 'Первичный приход каталога Отабек: 7 товарных позиций',
      lines,
    });
    receipt.paid = E.receiptCalc(receipt).goods;
    E.postReceipt(receipt.id);

    E._time = null;
    E.S.user = 'Администратор';
  }

  const catalog = () => PRODUCTS.flatMap((source) => source.sizes.map((size) => ({
    id: `ot-${source.externalId}-${size.id}`, code: `OT-${size.id}`, name: source.name,
    variantName: size.name, category: source.category, unit: 'шт', photo: source.photo,
    purchasePrice: 0, retailPrice: size.price, wholesalePrice: size.price, active: true,
    externalProductId: source.externalId, externalSizeId: size.id,
  })));
  window.Seed = { run, catalog };
})();
