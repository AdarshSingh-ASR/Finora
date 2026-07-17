const CATCH_ALL = new Set(["Miscellaneous", "Other", ""]);

export const categoryValues = [
  "Food & Dining", "Housing", "Transport", "Shopping", "Bills & Utilities",
  "Education", "Insurance", "Personal Care", "Taxes & Fees", "Gifts & Donations",
  "EMI", "Investment", "Health", "Entertainment", "Travel", "Salary",
  "Income", "Transfers", "Miscellaneous", "Other",
];

const merchantRules = [
  [/\bAMZN\b|AMAZON(?: SELLER SERVICES| PAY)?/i, "Amazon", "Shopping"],
  [/SWIGGY/i, "Swiggy", "Food & Dining"], [/ZOMATO/i, "Zomato", "Food & Dining"],
  [/BLINKIT|GROFERS/i, "Blinkit", "Food & Dining"], [/ZEPTO/i, "Zepto", "Food & Dining"],
  [/BIGBASKET/i, "BigBasket", "Food & Dining"], [/RELIANCE FRESH/i, "Reliance Fresh", "Food & Dining"],
  [/UBER/i, "Uber", "Transport"], [/OLA CABS?|OLACABS/i, "Ola", "Transport"], [/RAPIDO/i, "Rapido", "Transport"],
  [/NETFLIX/i, "Netflix", "Entertainment"], [/SPOTIFY/i, "Spotify", "Entertainment"],
  [/JIOHOTSTAR|HOTSTAR/i, "JioHotstar", "Entertainment"], [/BOOKMYSHOW/i, "BookMyShow", "Entertainment"],
  [/OPENAI|CHATGPT/i, "ChatGPT", "Entertainment"], [/ANTHROPIC|CLAUDE/i, "Claude", "Entertainment"],
  [/GOOGLE ONE/i, "Google One", "Entertainment"], [/CANVA/i, "Canva", "Entertainment"],
  [/APPLE(?:\.COM\/BILL| SERVICES)?/i, "Apple", "Entertainment"],
  [/CULT|CUREFIT/i, "Cult.fit", "Health"], [/1MG|PHARMEASY|NETMEDS/i, "Online pharmacy", "Health"], [/APOLLO(?: PHARM(?:ACY)?)?/i, "Apollo Pharmacy", "Health"],
  [/MYNTRA/i, "Myntra", "Shopping"], [/FLIPKART/i, "Flipkart", "Shopping"], [/AJIO/i, "AJIO", "Shopping"],
  [/GLOBAL FASHION|OFF DUTY/i, "Global Fashion Off Duty", "Shopping"],
  [/INDIGO|INTERGLOBE AVIATION/i, "IndiGo", "Travel"], [/AIR INDIA/i, "Air India", "Travel"],
  [/OYO(?: ROOMS)?/i, "OYO Rooms", "Travel"], [/MAKEMYTRIP|MAKE MY TRIP/i, "MakeMyTrip", "Travel"],
  [/IRCTC/i, "IRCTC", "Travel"], [/BOOKING\.COM/i, "Booking.com", "Travel"],
  [/RELIANCE JIO|\bJIO\b/i, "Jio", "Bills & Utilities"], [/AIRTEL/i, "Airtel", "Bills & Utilities"],
  [/BESCOM/i, "BESCOM", "Bills & Utilities"], [/CESC(?: KOLKATA)?/i, "CESC", "Bills & Utilities"],
  [/DREAMPLUG|\bCRED\b/i, "CRED", "Transfers"], [/UTKARSH SUPERCARD/i, "Utkarsh SuperCard", "EMI"],
  [/ZERODHA/i, "Zerodha", "Investment"], [/GROWW/i, "Groww", "Investment"],
  [/BLUE TOKAI/i, "Blue Tokai", "Food & Dining"], [/STARBUCKS/i, "Starbucks", "Food & Dining"],
];

const titleCase = (value) => value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

function extractCounterparty(raw) {
  const cleaned = String(raw || "").replace(/[_/|]+/g, " ").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/\b(?:paid\s+to|sent\s+to|received\s+from|transfer(?:red)?\s+to|beneficiary)\s+([a-z][a-z .'-]{2,60}?)(?=\s+(?:upi|transaction|txn|ref|reference|id|on|via|using|a\/c|account)\b|\s*[-,;]|$)/i);
  if (!match) return "";
  return titleCase(match[1].replace(/\b(?:private|limited|ltd)\b/gi, (part) => part).trim());
}

export function normalizeMerchantName(raw = "") {
  const source = String(raw || "").trim();
  const known = merchantRules.find(([pattern]) => pattern.test(source));
  if (known) return known[1];
  const counterparty = extractCounterparty(source);
  if (counterparty) return counterparty;
  const value = source.toUpperCase()
    .replace(/\b(?:UPI|P2M|P2P|POS|ACH|SI|BBPS|NEFT|IMPS|TXN|TRANSACTION|REF|REFERENCE|ID|PAID|RECEIVED|VIA)\b/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\b/gi, " ").replace(/\b\d{6,}\b/g, " ")
    .replace(/[\/_*|-]+/g, " ").replace(/\s+/g, " ").trim();
  const candidate = value.split(" ").filter(Boolean).slice(0, 5).join(" ");
  return candidate ? titleCase(candidate) : "Unknown merchant";
}

function rule(category, confidence, reason) { return { category, confidence, reason }; }

export function classifyNarration({ description = "", merchant = "", type = "debit" } = {}) {
  const text = `${merchant} ${description}`.replace(/\s+/g, " ").trim();
  const normalizedMerchant = normalizeMerchantName(merchant || description);
  const known = merchantRules.find(([pattern]) => pattern.test(text));
  const transferSignal = /\b(?:p2p|person.?to.?person|self transfer|own account|paid to|sent to|received from|imps|neft|fund transfer|upi transfer|cash withdrawal|atm withdrawal)\b/i.test(text);

  let match;
  if (transferSignal) match = rule("Transfers", .94, "The narration identifies a person-to-person, account, or cash movement rather than consumption.");
  else if (type === "credit" && /\b(?:salary|payroll|wages?|stipend)\b/i.test(text)) match = rule("Salary", .97, "The credit narration identifies salary or payroll income.");
  else if (type === "credit") match = rule("Income", .78, "The row is an incoming credit without evidence that it is a personal transfer.");
  else if (/\b(?:emi|loan repayment|loan instal+l?ment|credit card payment|supercard)\b/i.test(text)) match = rule("EMI", .94, "The narration identifies a loan, card, or instalment repayment.");
  else if (/\b(?:sip|mutual fund|index fund|demat|brokerage|zerodha|groww|investment|nps|ppf)\b/i.test(text)) match = rule("Investment", .95, "The narration identifies an investment contribution.");
  else if (/\b(?:swiggy|zomato|blinkit|zepto|restaurant|cafe|café|coffee|food|grocery|groceries|supermarket|bakery|pizza|kitchen|fresh)\b/i.test(text)) match = rule("Food & Dining", .9, "Food, restaurant, cafe, delivery, or grocery evidence appears in the narration.");
  else if (/\b(?:rent|housing|society maintenance|property maintenance|landlord)\b/i.test(text)) match = rule("Housing", .89, "The narration identifies rent, housing, or property maintenance.");
  else if (/\b(?:uber|ola|rapido|metro|fuel|petrol|diesel|parking|toll|cab|taxi|bus pass|fastag)\b/i.test(text)) match = rule("Transport", .9, "The narration identifies commuting, fuel, parking, or local transport.");
  else if (/\b(?:amazon|flipkart|myntra|ajio|retail|fashion|apparel|clothing|electronics|mall|store|supercard)\b/i.test(text)) match = rule("Shopping", .86, "The merchant or narration identifies retail or ecommerce spending.");
  else if (/\b(?:electric|electricity|power bill|bescom|cesc|airtel|jio|broadband|internet|water bill|gas bill|mobile recharge|postpaid|bbps|utility)\b/i.test(text)) match = rule("Bills & Utilities", .91, "The narration identifies a household utility or connectivity bill.");
  else if (/\b(?:school|college|university|tuition|course|udemy|coursera|education|exam fee|books?)\b/i.test(text)) match = rule("Education", .88, "The narration identifies education, tuition, courses, or learning materials.");
  else if (/\b(?:insurance|premium|lic policy|policybazaar)\b/i.test(text)) match = rule("Insurance", .91, "The narration identifies an insurance premium or policy payment.");
  else if (/\b(?:salon|spa|beauty|barber|grooming|cosmetic)\b/i.test(text)) match = rule("Personal Care", .86, "The narration identifies personal care or grooming.");
  else if (/\b(?:income tax|property tax|gst|government fee|bank charge|service charge|late fee|penalty|stamp duty)\b/i.test(text)) match = rule("Taxes & Fees", .84, "The narration identifies a tax, government fee, or financial charge.");
  else if (/\b(?:donation|charity|ngo|gift)\b/i.test(text)) match = rule("Gifts & Donations", .82, "The narration identifies a gift or charitable payment.");
  else if (/\b(?:hospital|pharmacy|medical|doctor|clinic|diagnostic|health|cult|curefit|gym|medicine)\b/i.test(text)) match = rule("Health", .91, "The narration identifies healthcare, medicine, diagnostics, or fitness.");
  else if (/\b(?:netflix|spotify|cinema|bookmyshow|hotstar|prime video|canva|chatgpt|claude|gaming|subscription)\b/i.test(text)) match = rule("Entertainment", .88, "The narration identifies streaming, media, software, or entertainment.");
  else if (/\b(?:airline|indigo|air india|hotel|oyo|makemytrip|booking\.com|airbnb|flight|resort|travel|irctc)\b/i.test(text)) match = rule("Travel", .92, "The narration identifies flights, hotels, rail, or travel bookings.");
  else if (known?.[2]) match = rule(known[2], .9, `The merchant is recognized as ${known[1]}.`);
  else match = rule("Miscellaneous", .35, "The narration does not contain enough reliable merchant or purpose evidence for a specific category.");

  return { ...match, merchant: normalizedMerchant };
}

export function refineTransaction(transaction, { catchAllOnly = true } = {}) {
  const existingCategory = String(transaction?.category || "");
  const classified = classifyNarration(transaction || {});
  const genericMerchant = !transaction?.merchant || /^(?:unknown(?: merchant| transaction)?|other|miscellaneous)$/i.test(String(transaction.merchant).trim());
  const shouldReplaceCategory = (!catchAllOnly || CATCH_ALL.has(existingCategory)) && classified.category !== "Miscellaneous" && classified.confidence >= .72;
  const shouldReplaceMerchant = genericMerchant || normalizeMerchantName(transaction.merchant) !== transaction.merchant && classified.confidence >= .72;
  return {
    ...transaction,
    ...(shouldReplaceMerchant ? { merchant: classified.merchant } : {}),
    ...(shouldReplaceCategory ? {
      category: classified.category,
      confidence: Math.max(Number(transaction.confidence) || 0, classified.confidence),
      explanation: classified.reason,
    } : {}),
  };
}

export function refineTransactionsForAnalysis(transactions = []) {
  return transactions.map((transaction) => refineTransaction(transaction, { catchAllOnly: true }));
}

export function isCatchAllCategory(category) { return CATCH_ALL.has(String(category || "")); }

export function transactionDetail(transaction) {
  const refined = refineTransaction(transaction, { catchAllOnly: true });
  const merchant = refined.merchant || normalizeMerchantName(refined.description);
  return `${merchant} · ${refined.category} · ${refined.type === "credit" ? "money in" : "money out"}`;
}
