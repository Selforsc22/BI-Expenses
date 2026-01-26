import { query } from '../config/database';
import { ExpenseCategorizationResult } from '../types';

interface CategoryRule {
  id: string;
  vendorPattern: string;
  categoryId: string;
  categoryName: string;
  priority: number;
}

interface CategoryMatch {
  categoryId: string;
  categoryName: string;
  confidence: number;
  matchType: 'rule' | 'keyword' | 'history' | 'ml';
}

// Keyword mappings for auto-categorization
const categoryKeywords: Record<string, string[]> = {
  'Office Supplies': [
    'office', 'supplies', 'staples', 'paper', 'pens', 'printer', 'ink', 'toner',
    'desk', 'chair', 'furniture', 'stationery', 'folders', 'binders'
  ],
  'Travel': [
    'airline', 'flight', 'hotel', 'motel', 'uber', 'lyft', 'taxi', 'car rental',
    'hertz', 'enterprise', 'avis', 'delta', 'united', 'american airlines',
    'southwest', 'marriott', 'hilton', 'airbnb', 'expedia', 'booking.com'
  ],
  'Marketing': [
    'google ads', 'facebook', 'meta', 'advertising', 'marketing', 'promotion',
    'billboard', 'mailchimp', 'hubspot', 'linkedin ads', 'twitter ads',
    'campaign', 'branding', 'seo', 'sem', 'advertising'
  ],
  'Utilities': [
    'electric', 'gas', 'water', 'utility', 'power', 'energy', 'con edison',
    'pge', 'sewage', 'trash', 'waste management', 'recycling'
  ],
  'Software & Subscriptions': [
    'software', 'subscription', 'saas', 'aws', 'azure', 'google cloud',
    'microsoft', 'adobe', 'slack', 'zoom', 'github', 'atlassian', 'jira',
    'salesforce', 'dropbox', 'notion', 'figma', 'canva'
  ],
  'Meals & Entertainment': [
    'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonalds', 'subway',
    'chipotle', 'doordash', 'grubhub', 'uber eats', 'catering',
    'entertainment', 'event', 'tickets', 'movies', 'concert'
  ],
  'Professional Services': [
    'legal', 'attorney', 'lawyer', 'accounting', 'cpa', 'consultant',
    'consulting', 'advisory', 'professional', 'contractor', 'freelance'
  ],
  'Rent': [
    'rent', 'lease', 'property', 'real estate', 'office space', 'coworking',
    'wework', 'regus'
  ],
  'Insurance': [
    'insurance', 'coverage', 'policy', 'premium', 'liability', 'workers comp',
    'health insurance', 'dental', 'vision'
  ],
  'Equipment': [
    'equipment', 'hardware', 'computer', 'laptop', 'monitor', 'keyboard',
    'mouse', 'server', 'network', 'router', 'phone', 'iphone', 'android',
    'machinery', 'tools'
  ],
  'Payroll': [
    'payroll', 'salary', 'wages', 'adp', 'gusto', 'paychex', 'quickbooks payroll'
  ],
};

export class ExpenseCategorizor {
  private companyId: string;
  private categoryCache: Map<string, { id: string; name: string }> = new Map();
  private rulesCache: CategoryRule[] = [];

  constructor(companyId: string) {
    this.companyId = companyId;
  }

  async initialize(): Promise<void> {
    // Load categories
    const categories = await query<{ id: string; name: string }>(
      `SELECT id, name FROM categories WHERE company_id = $1 AND type = 'expense' AND is_active = true`,
      [this.companyId]
    );

    categories.forEach(cat => {
      this.categoryCache.set(cat.name.toLowerCase(), { id: cat.id, name: cat.name });
    });

    // Load custom rules
    const rules = await query<CategoryRule>(
      `SELECT vcr.id, vcr.vendor_pattern as "vendorPattern", vcr.category_id as "categoryId",
              c.name as "categoryName", vcr.priority
       FROM vendor_category_rules vcr
       JOIN categories c ON vcr.category_id = c.id
       WHERE vcr.company_id = $1 AND vcr.is_active = true
       ORDER BY vcr.priority DESC`,
      [this.companyId]
    );

    this.rulesCache = rules;
  }

  async categorize(
    vendorName: string,
    description: string,
    amount?: number
  ): Promise<ExpenseCategorizationResult> {
    const searchText = `${vendorName} ${description}`.toLowerCase();
    const matches: CategoryMatch[] = [];

    // 1. Check custom rules first (highest priority)
    for (const rule of this.rulesCache) {
      if (searchText.includes(rule.vendorPattern.toLowerCase())) {
        matches.push({
          categoryId: rule.categoryId,
          categoryName: rule.categoryName,
          confidence: 0.95,
          matchType: 'rule',
        });
        break;
      }
    }

    // 2. Check keyword mappings
    for (const [categoryName, keywords] of Object.entries(categoryKeywords)) {
      const matchedKeywords = keywords.filter(kw => searchText.includes(kw.toLowerCase()));
      if (matchedKeywords.length > 0) {
        const category = this.categoryCache.get(categoryName.toLowerCase());
        if (category) {
          // Higher confidence with more keyword matches
          const confidence = Math.min(0.5 + (matchedKeywords.length * 0.1), 0.85);
          matches.push({
            categoryId: category.id,
            categoryName: category.name,
            confidence,
            matchType: 'keyword',
          });
        }
      }
    }

    // 3. Check historical patterns (same vendor)
    const historicalMatch = await this.findHistoricalMatch(vendorName);
    if (historicalMatch) {
      matches.push({
        ...historicalMatch,
        matchType: 'history',
      });
    }

    // Sort by confidence and return best match
    matches.sort((a, b) => b.confidence - a.confidence);

    if (matches.length === 0) {
      // Default to 'Other' category
      const otherCategory = this.categoryCache.get('other');
      return {
        categoryId: otherCategory?.id || '',
        categoryName: otherCategory?.name || 'Other',
        confidence: 0.1,
        suggestedAlternatives: [],
      };
    }

    const bestMatch = matches[0];
    const alternatives = matches
      .slice(1, 4)
      .filter(m => m.categoryId !== bestMatch.categoryId)
      .map(m => ({
        categoryId: m.categoryId,
        categoryName: m.categoryName,
        confidence: m.confidence,
      }));

    return {
      categoryId: bestMatch.categoryId,
      categoryName: bestMatch.categoryName,
      confidence: bestMatch.confidence,
      suggestedAlternatives: alternatives,
    };
  }

  private async findHistoricalMatch(vendorName: string): Promise<CategoryMatch | null> {
    if (!vendorName) return null;

    // Find most common category for this vendor
    const result = await query<{ category_id: string; category_name: string; count: string }>(
      `SELECT e.category_id, c.name as category_name, COUNT(*) as count
       FROM expenses e
       JOIN categories c ON e.category_id = c.id
       WHERE e.company_id = $1
         AND e.vendor_name ILIKE $2
         AND e.category_id IS NOT NULL
       GROUP BY e.category_id, c.name
       ORDER BY count DESC
       LIMIT 1`,
      [this.companyId, `%${vendorName}%`]
    );

    if (result.length === 0) return null;

    const count = parseInt(result[0].count);
    // Higher confidence with more historical matches
    const confidence = Math.min(0.6 + (count * 0.05), 0.9);

    return {
      categoryId: result[0].category_id,
      categoryName: result[0].category_name,
      confidence,
      matchType: 'history',
    };
  }

  async addRule(vendorPattern: string, categoryId: string): Promise<void> {
    await query(
      `INSERT INTO vendor_category_rules (company_id, vendor_pattern, category_id, priority)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (company_id, vendor_pattern)
       DO UPDATE SET category_id = $3`,
      [this.companyId, vendorPattern.toLowerCase(), categoryId]
    );

    // Refresh cache
    await this.initialize();
  }

  async batchCategorize(
    expenses: Array<{ id: string; vendorName: string; description: string; amount?: number }>
  ): Promise<Map<string, ExpenseCategorizationResult>> {
    const results = new Map<string, ExpenseCategorizationResult>();

    for (const expense of expenses) {
      const result = await this.categorize(
        expense.vendorName,
        expense.description,
        expense.amount
      );
      results.set(expense.id, result);
    }

    return results;
  }

  async detectDuplicates(
    vendorName: string,
    amount: number,
    date: Date,
    daysWindow: number = 3
  ): Promise<Array<{ id: string; matchScore: number }>> {
    const result = await query<{ id: string; vendor_name: string; amount: string; expense_date: string }>(
      `SELECT id, vendor_name, amount, expense_date
       FROM expenses
       WHERE company_id = $1
         AND ABS(amount - $2) < 0.01
         AND expense_date BETWEEN $3::date - $4 AND $3::date + $4`,
      [this.companyId, amount, date, daysWindow]
    );

    return result
      .filter(exp => {
        const vendorMatch = this.calculateSimilarity(
          vendorName.toLowerCase(),
          exp.vendor_name?.toLowerCase() || ''
        );
        return vendorMatch > 0.7;
      })
      .map(exp => ({
        id: exp.id,
        matchScore: this.calculateSimilarity(
          vendorName.toLowerCase(),
          exp.vendor_name?.toLowerCase() || ''
        ),
      }));
  }

  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (!str1 || !str2) return 0;

    // Levenshtein distance-based similarity
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - distance / maxLen;
  }

  async flagUnusualExpenses(
    threshold: number = 2
  ): Promise<Array<{ id: string; reason: string; deviation: number }>> {
    // Get average expense by category
    const avgByCategory = await query<{ category_id: string; avg_amount: string; stddev: string }>(
      `SELECT category_id, AVG(amount) as avg_amount, STDDEV(amount) as stddev
       FROM expenses
       WHERE company_id = $1
         AND expense_date >= CURRENT_DATE - INTERVAL '90 days'
       GROUP BY category_id`,
      [this.companyId]
    );

    const categoryStats = new Map(
      avgByCategory.map(c => [c.category_id, {
        avg: parseFloat(c.avg_amount),
        stddev: parseFloat(c.stddev) || 0,
      }])
    );

    // Find unusual expenses (more than threshold standard deviations from mean)
    const recentExpenses = await query<{ id: string; category_id: string; amount: string; vendor_name: string }>(
      `SELECT id, category_id, amount, vendor_name
       FROM expenses
       WHERE company_id = $1
         AND expense_date >= CURRENT_DATE - INTERVAL '30 days'`,
      [this.companyId]
    );

    const flagged: Array<{ id: string; reason: string; deviation: number }> = [];

    for (const expense of recentExpenses) {
      const stats = categoryStats.get(expense.category_id);
      if (!stats || stats.stddev === 0) continue;

      const amount = parseFloat(expense.amount);
      const deviation = Math.abs(amount - stats.avg) / stats.stddev;

      if (deviation > threshold) {
        flagged.push({
          id: expense.id,
          reason: amount > stats.avg
            ? `Amount $${amount} is unusually high for this category`
            : `Amount $${amount} is unusually low for this category`,
          deviation: Math.round(deviation * 100) / 100,
        });
      }
    }

    return flagged;
  }
}

export default ExpenseCategorizor;
