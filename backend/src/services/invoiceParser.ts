import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { InvoiceImportResult } from '../types';

interface ParsedInvoiceData {
  invoiceNumber?: string;
  vendorName?: string;
  customerName?: string;
  invoiceDate?: string;
  dueDate?: string;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  lineItems?: ParsedLineItem[];
  rawText?: string;
}

interface ParsedLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  taxRate?: number;
}

export class InvoiceParser {
  // Common patterns for invoice data extraction
  private static patterns = {
    invoiceNumber: [
      /invoice\s*#?\s*:?\s*([A-Z0-9-]+)/i,
      /inv\s*#?\s*:?\s*([A-Z0-9-]+)/i,
      /number\s*:?\s*([A-Z0-9-]+)/i,
      /reference\s*:?\s*([A-Z0-9-]+)/i,
    ],
    date: [
      /(?:invoice\s*)?date\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
      /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/,
      /(\w+\s+\d{1,2},?\s+\d{4})/i,
    ],
    dueDate: [
      /due\s*(?:date)?\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
      /payment\s*due\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
    ],
    total: [
      /total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /amount\s*due\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /grand\s*total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /balance\s*due\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    ],
    subtotal: [
      /subtotal\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /sub-total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    ],
    tax: [
      /tax\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /vat\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /gst\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
      /sales\s*tax\s*:?\s*\$?\s*([\d,]+\.?\d*)/i,
    ],
    vendorName: [
      /from\s*:?\s*(.+?)(?:\n|$)/i,
      /vendor\s*:?\s*(.+?)(?:\n|$)/i,
      /bill\s*from\s*:?\s*(.+?)(?:\n|$)/i,
    ],
  };

  static async parseFile(filePath: string): Promise<InvoiceImportResult> {
    const ext = path.extname(filePath).toLowerCase();

    try {
      let result: InvoiceImportResult;

      switch (ext) {
        case '.pdf':
          result = await this.parsePDF(filePath);
          break;
        case '.csv':
          result = await this.parseCSV(filePath);
          break;
        case '.xlsx':
        case '.xls':
          result = await this.parseExcel(filePath);
          break;
        default:
          return {
            success: false,
            errors: [`Unsupported file format: ${ext}`],
          };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to parse file: ${(error as Error).message}`],
      };
    }
  }

  static async parsePDF(filePath: string): Promise<InvoiceImportResult> {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      const text = pdfData.text;

      const extractedData = this.extractDataFromText(text);

      if (!extractedData.invoiceNumber && !extractedData.totalAmount) {
        return {
          success: false,
          errors: ['Could not extract invoice data from PDF'],
          confidence: 0,
        };
      }

      return {
        success: true,
        invoice: {
          invoice_number: extractedData.invoiceNumber || 'UNKNOWN',
          vendor_name: extractedData.vendorName,
          invoice_date: extractedData.invoiceDate ? new Date(extractedData.invoiceDate) : new Date(),
          due_date: extractedData.dueDate ? new Date(extractedData.dueDate) : undefined,
          subtotal: extractedData.subtotal || extractedData.totalAmount || 0,
          tax_amount: extractedData.taxAmount || 0,
          total_amount: extractedData.totalAmount || 0,
        },
        lineItems: extractedData.lineItems?.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.total,
          tax_rate: item.taxRate || 0,
        })),
        confidence: this.calculateConfidence(extractedData),
      };
    } catch (error) {
      return {
        success: false,
        errors: [`PDF parsing failed: ${(error as Error).message}`],
      };
    }
  }

  static async parseCSV(filePath: string): Promise<InvoiceImportResult> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const records = csvParse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (records.length === 0) {
        return {
          success: false,
          errors: ['CSV file is empty or has no valid data'],
        };
      }

      // Try to detect if this is a single invoice or multiple line items
      const firstRecord = records[0];
      const hasInvoiceNumber = this.findColumn(firstRecord, ['invoice', 'inv', 'number', 'invoice_number', 'invoicenumber']);
      const hasDescription = this.findColumn(firstRecord, ['description', 'desc', 'item', 'product', 'service']);
      const hasAmount = this.findColumn(firstRecord, ['amount', 'total', 'price', 'cost', 'value']);
      const hasQuantity = this.findColumn(firstRecord, ['quantity', 'qty', 'count']);

      if (hasDescription && hasAmount) {
        // Parse as line items
        const lineItems: ParsedLineItem[] = records.map((record: any) => ({
          description: record[hasDescription] || '',
          quantity: parseFloat((hasQuantity ? record[hasQuantity] : null) || '1') || 1,
          unitPrice: parseFloat(this.cleanCurrencyValue(record[hasAmount])) || 0,
          total: parseFloat(this.cleanCurrencyValue(record[hasAmount])) || 0,
        }));

        const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);

        return {
          success: true,
          invoice: {
            invoice_number: (hasInvoiceNumber ? records[0][hasInvoiceNumber] : null) || 'CSV-IMPORT',
            vendor_name: this.findValueByKey(records[0], ['vendor', 'supplier', 'from', 'company']),
            invoice_date: new Date(),
            total_amount: totalAmount,
            subtotal: totalAmount,
            tax_amount: 0,
          },
          lineItems: lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total: item.total,
            tax_rate: 0,
          })),
          confidence: 0.7,
        };
      }

      return {
        success: false,
        errors: ['Could not determine CSV structure. Expected columns: description/item, amount/total'],
      };
    } catch (error) {
      return {
        success: false,
        errors: [`CSV parsing failed: ${(error as Error).message}`],
      };
    }
  }

  static async parseExcel(filePath: string): Promise<InvoiceImportResult> {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (data.length < 2) {
        return {
          success: false,
          errors: ['Excel file is empty or has insufficient data'],
        };
      }

      // First row as headers
      const headers = (data[0] as string[]).map(h => String(h).toLowerCase().trim());
      const rows = data.slice(1) as any[][];

      // Find relevant columns
      const descIdx = headers.findIndex(h =>
        ['description', 'desc', 'item', 'product', 'service', 'name'].some(k => h.includes(k))
      );
      const qtyIdx = headers.findIndex(h =>
        ['quantity', 'qty', 'count', 'units'].some(k => h.includes(k))
      );
      const priceIdx = headers.findIndex(h =>
        ['price', 'unit price', 'rate', 'unit_price', 'unitprice'].some(k => h.includes(k))
      );
      const amountIdx = headers.findIndex(h =>
        ['amount', 'total', 'line total', 'subtotal'].some(k => h.includes(k))
      );
      const invoiceNumIdx = headers.findIndex(h =>
        ['invoice', 'inv', 'number', 'invoice_number', 'invoice number'].some(k => h.includes(k))
      );

      if (descIdx === -1) {
        return {
          success: false,
          errors: ['Could not find description/item column in Excel file'],
        };
      }

      const lineItems: ParsedLineItem[] = rows
        .filter(row => row[descIdx])
        .map(row => {
          const quantity = qtyIdx >= 0 ? parseFloat(row[qtyIdx]) || 1 : 1;
          const unitPrice = priceIdx >= 0 ? parseFloat(this.cleanCurrencyValue(row[priceIdx])) : 0;
          const total = amountIdx >= 0
            ? parseFloat(this.cleanCurrencyValue(row[amountIdx]))
            : quantity * unitPrice;

          return {
            description: String(row[descIdx] || ''),
            quantity,
            unitPrice: unitPrice || total / quantity,
            total: total || quantity * unitPrice,
          };
        });

      const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);
      const invoiceNumber = invoiceNumIdx >= 0 && rows[0][invoiceNumIdx]
        ? String(rows[0][invoiceNumIdx])
        : 'EXCEL-IMPORT';

      return {
        success: true,
        invoice: {
          invoice_number: invoiceNumber,
          invoice_date: new Date(),
          total_amount: totalAmount,
          subtotal: totalAmount,
          tax_amount: 0,
        },
        lineItems: lineItems.map(item => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: item.total,
          tax_rate: 0,
        })),
        confidence: 0.75,
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Excel parsing failed: ${(error as Error).message}`],
      };
    }
  }

  private static extractDataFromText(text: string): ParsedInvoiceData {
    const data: ParsedInvoiceData = { rawText: text };

    // Extract invoice number
    for (const pattern of this.patterns.invoiceNumber) {
      const match = text.match(pattern);
      if (match) {
        data.invoiceNumber = match[1].trim();
        break;
      }
    }

    // Extract dates
    for (const pattern of this.patterns.date) {
      const match = text.match(pattern);
      if (match) {
        data.invoiceDate = match[1];
        break;
      }
    }

    for (const pattern of this.patterns.dueDate) {
      const match = text.match(pattern);
      if (match) {
        data.dueDate = match[1];
        break;
      }
    }

    // Extract amounts
    for (const pattern of this.patterns.total) {
      const match = text.match(pattern);
      if (match) {
        data.totalAmount = parseFloat(this.cleanCurrencyValue(match[1]));
        break;
      }
    }

    for (const pattern of this.patterns.subtotal) {
      const match = text.match(pattern);
      if (match) {
        data.subtotal = parseFloat(this.cleanCurrencyValue(match[1]));
        break;
      }
    }

    for (const pattern of this.patterns.tax) {
      const match = text.match(pattern);
      if (match) {
        data.taxAmount = parseFloat(this.cleanCurrencyValue(match[1]));
        break;
      }
    }

    // Extract vendor name
    for (const pattern of this.patterns.vendorName) {
      const match = text.match(pattern);
      if (match) {
        data.vendorName = match[1].trim().substring(0, 255);
        break;
      }
    }

    // Try to extract line items (basic pattern matching)
    data.lineItems = this.extractLineItems(text);

    return data;
  }

  private static extractLineItems(text: string): ParsedLineItem[] {
    const lineItems: ParsedLineItem[] = [];

    // Pattern for line items: description, quantity, price, total
    const linePattern = /(.{10,50})\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)/g;

    let match;
    while ((match = linePattern.exec(text)) !== null) {
      const [, description, quantity, unitPrice, total] = match;
      lineItems.push({
        description: description.trim(),
        quantity: parseFloat(quantity) || 1,
        unitPrice: parseFloat(this.cleanCurrencyValue(unitPrice)) || 0,
        total: parseFloat(this.cleanCurrencyValue(total)) || 0,
      });
    }

    return lineItems;
  }

  private static cleanCurrencyValue(value: any): string {
    if (typeof value !== 'string') {
      return String(value || '0');
    }
    return value.replace(/[$,\s]/g, '');
  }

  private static findColumn(record: any, possibleNames: string[]): string | null {
    const keys = Object.keys(record).map(k => k.toLowerCase());
    for (const name of possibleNames) {
      const found = keys.find(k => k.includes(name));
      if (found) {
        return Object.keys(record).find(k => k.toLowerCase() === found) || null;
      }
    }
    return null;
  }

  private static findValueByKey(record: any, possibleNames: string[]): string | undefined {
    for (const name of possibleNames) {
      const key = Object.keys(record).find(k => k.toLowerCase().includes(name));
      if (key && record[key]) {
        return String(record[key]);
      }
    }
    return undefined;
  }

  private static calculateConfidence(data: ParsedInvoiceData): number {
    let confidence = 0;
    const weights = {
      invoiceNumber: 0.2,
      invoiceDate: 0.15,
      totalAmount: 0.25,
      subtotal: 0.1,
      taxAmount: 0.1,
      vendorName: 0.1,
      lineItems: 0.1,
    };

    if (data.invoiceNumber) confidence += weights.invoiceNumber;
    if (data.invoiceDate) confidence += weights.invoiceDate;
    if (data.totalAmount) confidence += weights.totalAmount;
    if (data.subtotal) confidence += weights.subtotal;
    if (data.taxAmount !== undefined) confidence += weights.taxAmount;
    if (data.vendorName) confidence += weights.vendorName;
    if (data.lineItems && data.lineItems.length > 0) confidence += weights.lineItems;

    return Math.min(confidence, 1);
  }
}

export default InvoiceParser;
