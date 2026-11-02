// Public layout metadata only. Private source invoices and literal tax identifiers are not fixtures.
export const INVOICE_SUPPLIER_PROFILES=Object.freeze([
  {
    "id": "tbi",
    "title": "ת.ב.י.",
    "issuerTaxHash": "1dd6d18803af5aad290bc6f08a02c3c1b1f29d94276ac7101d9c80b50acd6cbc",
    "aliases": [
      "תביר היטים"
    ],
    "layout": "tbi"
  },
  {
    "id": "komotayim",
    "title": "קומותיים",
    "issuerTaxHash": "0e105b365d901aa83d35666a4f230bd1dcd5faed0eb5a84f9c2a24053049f798",
    "aliases": [
      "קומותיים"
    ],
    "layout": "morning"
  },
  {
    "id": "kualita",
    "title": "קואליטה",
    "issuerTaxHash": "5d2b487017ef4b77dcf7d220f3f25f0a30caad74b5530e13745b9312ce517cae",
    "aliases": [
      "קואליטה"
    ],
    "layout": "morning",
    // Older issuer PDFs overlap Hebrew glyph runs in these summary labels.
    // Match only these observed search keys; raw glyphs and source quads remain intact.
    "summaryLabelKeys": {"net":["הסכ"],"vat":["עממ"],"gross":["הסכלתשלום","הסכהוחזר"]}
  },
  {
    "id": "freddy",
    "title": "פרדי",
    "issuerTaxHash": "b25cb14ba894c0ce8fd350e2b2cd3dd1320bfc12babfe9fef09dbf4858837adc",
    "aliases": [
      "פרדי"
    ],
    "layout": "hash"
  },
  {
    "id": "roya",
    "title": "רואיה",
    "issuerTaxHash": "3048278b3ec7b2841cccebb31ce17340d5ea09b4d3f4ce0b9c4defa89d70c9b5",
    "aliases": [
      "רואיה"
    ],
    "layout": "bina",
    "verifiedNumberPrefixes": [
      "s"
    ],
    "normalizationEvidence": "paired-reported-pdf-2026-07"
  },
  {
    "id": "medy",
    "title": "מדי קומפורט",
    "issuerTaxHash": "4ece6a255002574b659219dba0b731352903958c4e774d4307db654835fcb1bf",
    "aliases": [
      "מדי קומפורט",
      "דיז נכסים והשקעות"
    ],
    "layout": "sap"
  },
  {
    "id": "yesharim",
    "title": "קומפורט ישרים",
    "issuerTaxHash": "519266a7d546c1393e9f392d2eeadb67d07a80a60c91a223fa7b94878fcfa5f2",
    "aliases": [
      "קומפורט ישרים"
    ],
    "layout": "priority",
    "verifiedNumberPrefixes": ["SI"],
    "normalizationEvidence": "user-confirmed-source-number-2026-10-27"
  },
  {
    "id": "cocktail",
    "title": "צ.ד. קוקטייל",
    "issuerTaxHash": "4ea2a48a89e99699f3d5ae50253ed265790f8292c5bba3b30e58a04d10c80b85",
    "aliases": [
      "קוקטייל"
    ],
    "layout": "priority",
    "verifiedNumberPrefixes": ["CR","SI"],
    "normalizationEvidence": "CR:user-confirmed-2026-10-27;SI:paired-reported-pdf-2026-03-04"
  },
  {
    "id": "royal",
    "title": "ק. רויאל",
    "issuerTaxHash": "d0256c899ea5b3e7d56287f3ba7f77f92760c90956d93de45f092ab4eb0aea61",
    "aliases": [
      "רויאל"
    ],
    "layout": "hash",
    "numberBelowTitle": true
  },
  {
    "id": "yossi",
    "title": "יוסי תקשורת",
    "issuerTaxHash": "8e1f6815e3652f6656fdd2f51fdf6c1bf49b8464cf013fc17438a6b9d932ca55",
    "aliases": ["יוסי תקשורת"],
    "layout": "morning",
    "issuerRegion": "left-column"
  },
  {
    "id": "erotex",
    "title": "ארוטקס",
    "issuerTaxHash": "6fb541ebb8118621a267a166a2ea580a56da7bb83bf5084cbd459fd8764ca8af",
    "aliases": ["ארוטקס"],
    "layout": "hash",
    "summaryLabelKeys": {"net":["סהכחייבבמעמ"],"gross":["סכוםלתשלום"]}
  },
  {
    "id": "bezeq",
    "title": "בזק",
    "issuerTaxHash": "80c7aad77688bcb6d8c8c76c5030926a2dfdb17f0ae3b8ba07510faede9534f9",
    "aliases": ["בזק החברה הישראלית לתקשורת"],
    "layout": "bezeq",
    "issuerRegion": "left-column",
    "numberPlacement": {"minDy":5,"maxDy":20,"minX":0,"maxX":230},
    "numberDigits": 9,
    "dateLabelKeys": ["תאריךעריכתהחשבון"],
    "summaryLabelKeys": {"net":["סהכהחשבוניתלפנימעמ"],"vat":["מעמעל"],"gross":["סהכלתשלוםכוללמעמ"]},
    "summaryFirstPage": true,
    "vatAmountOutsideLabel": true,
    "paymentConditional": true
  },
  {
    "id": "herbawi",
    "title": "חרבאווי",
    "issuerTaxHash": "4b662be9ee841138e9aabe4c5ff1d532bea397f30bf3ccdd1104bb16c7d5720e",
    "aliases": ["Herbawi Industrial Trading Company"],
    "layout": "bisan",
    "creditTitleKey": "חשבונותזיכוי",
    "datePlacement": {"minDy":0,"maxDy":25,"minX":0,"maxX":120},
    "numberFormat": "p-final-segment",
    "numberFormatEvidence": "user-confirmed-final-segment-2026-11-02"
  },
  {
    "id": "gaber",
    "title": "א.מ. גבר",
    "issuerTaxHash": "e098e4875ada13457d0f4e32665585e2f77bac0a331bed94bd7f3631f057707a",
    "aliases": [
      "גבר"
    ],
    "layout": "priority-print",
    "verifiedNumberPrefixes": [
      "SI",
      "CR"
    ],
    "normalizationEvidence": "paired-reported-pdf-2026-07-08",
    "issuerRegion": "footer",
    "numberPlacement": {
      "minDy": 35,
      "maxDy": 60,
      "minX": 0,
      "maxX": 200
    },
    "derivedNet": true
  }
].map(profile=>Object.freeze(profile)));
