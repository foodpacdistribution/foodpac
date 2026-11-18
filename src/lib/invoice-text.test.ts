import { describe, expect, it } from "vitest";
import { nameLikeness, parseInvoiceText } from "./invoice-text";

// What the phone recognised in a real photo of a printed invoice, mistakes and all.
const PHOTO = `FOODPAC pISTRIBUTION PTY LTD
Fo 2) ac
INVOICE
Sushi Paradise (Toowong)
BILL TO ship TO 002278
BULTO amo Toowong @LO KE Eriko 3, TESUS as SNE. Ho 18,2028
red sos DATE DUE:
Toowong, 4066 Toowong, 4066 SALES ORDER TYPE Sundwre
CREDIT TERM:
DELIVERY METHOD!
DELIVERY TERMS:
a PRICE UNIT ary DISC. TAX AMOUNT (AUD)
SALES ORDER S0002343
1 PAPER BOWL 520m! 102.00 CTN [20.00] 1.00 - 10.20 102.00
TOTAL QUANTITY 2.00
Sub Total 28573
GST (10%) 1540
Invoice Amount pr 5 sia $300.83
Amount Due EE od $300.83
NAME: Foodpac Distribution aa EF
BSB: 014-269 a
ACCOUNT: 803-095-111 Eo E
i 4
INV002276 . Paget`;

describe("parseInvoiceText", () => {
  it("reads a real photo's invoice number, sales order, customer, town and amount", () => {
    expect(parseInvoiceText(PHOTO)).toEqual({
      invoiceNumber: "INV002276",
      salesOrderNumber: "SO002343",
      customerName: "Sushi Paradise (Toowong)",
      area: "Toowong 4066",
      postcode: "4066",
      totalCents: 30083,
    });
  });

  it("puts right letters read in place of digits", () => {
    const r = parseInvoiceText("INVOICE\nNoodle Bar\nBILL TO\nINV0O12l5\nSALES ORDER SOO1234");
    expect(r.invoiceNumber).toBe("INV001215");
    expect(r.salesOrderNumber).toBe("SO01234");
    expect(r.customerName).toBe("Noodle Bar");
  });

  it("gives nothing rather than a guess", () => {
    expect(parseInvoiceText("blurry\nnothing here")).toEqual({ invoiceNumber: null, salesOrderNumber: null, customerName: null, area: null, postcode: null, totalCents: null });
  });
});

describe("nameLikeness", () => {
  it("scores a misread name close to the real one, and other shops low", () => {
    expect(nameLikeness("Sushi Paradise (Toowong)", "Sushi Paradise (Toowong)")).toBe(1);
    expect(nameLikeness("Sushl Paradise (Toowong", "Sushi Paradise (Toowong)")).toBeGreaterThan(0.85);
    expect(nameLikeness("Sushi Paradise (Toowong)", "Sushi Paradise (Jindalee)")).toBeLessThan(0.75);
    expect(nameLikeness("Sushi Paradise (Toowong)", "Noodle Bar")).toBeLessThan(0.2);
  });
});
