import bcrypt from 'bcryptjs';
import { pool, query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

async function seedDatabase() {
  console.log('Starting database seeding...\n');

  try {
    // Check if data already exists
    const existingUsers = await query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    if (parseInt(existingUsers[0].count) > 0) {
      console.log('Database already has data. Skipping seed.');
      await pool.end();
      return;
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create demo company
      const companyId = uuidv4();
      await client.query(`
        INSERT INTO companies (id, name, email, currency, fiscal_year_start)
        VALUES ($1, $2, $3, $4, $5)
      `, [companyId, 'Demo Company', 'demo@businesshub.com', 'USD', 1]);
      console.log('✅ Created demo company');

      // Create admin user
      const adminId = uuidv4();
      const hashedPassword = await bcrypt.hash('admin123', 12);
      await client.query(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, is_active, email_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [adminId, 'admin@businesshub.com', hashedPassword, 'Admin', 'User', 'admin', companyId, true, true]);
      console.log('✅ Created admin user (admin@businesshub.com / admin123)');

      // Create demo manager
      const managerId = uuidv4();
      await client.query(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, company_id, is_active, email_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [managerId, 'manager@businesshub.com', hashedPassword, 'Manager', 'User', 'manager', companyId, true, true]);
      console.log('✅ Created manager user');

      // Create expense categories
      const expenseCategories = [
        { name: 'Office Supplies', color: '#4CAF50' },
        { name: 'Travel', color: '#2196F3' },
        { name: 'Marketing', color: '#FF9800' },
        { name: 'Utilities', color: '#9C27B0' },
        { name: 'Software & Subscriptions', color: '#00BCD4' },
        { name: 'Meals & Entertainment', color: '#E91E63' },
        { name: 'Professional Services', color: '#607D8B' },
        { name: 'Rent', color: '#795548' },
        { name: 'Insurance', color: '#3F51B5' },
        { name: 'Equipment', color: '#009688' },
        { name: 'Payroll', color: '#F44336' },
        { name: 'Other', color: '#9E9E9E' },
      ];

      for (const cat of expenseCategories) {
        await client.query(`
          INSERT INTO categories (id, company_id, name, type, color)
          VALUES ($1, $2, $3, $4, $5)
        `, [uuidv4(), companyId, cat.name, 'expense', cat.color]);
      }
      console.log('✅ Created expense categories');

      // Create revenue categories
      const revenueCategories = [
        { name: 'Product Sales', color: '#4CAF50' },
        { name: 'Services', color: '#2196F3' },
        { name: 'Consulting', color: '#FF9800' },
        { name: 'Subscriptions', color: '#9C27B0' },
        { name: 'Licensing', color: '#00BCD4' },
        { name: 'Other Income', color: '#9E9E9E' },
      ];

      for (const cat of revenueCategories) {
        await client.query(`
          INSERT INTO categories (id, company_id, name, type, color)
          VALUES ($1, $2, $3, $4, $5)
        `, [uuidv4(), companyId, cat.name, 'revenue', cat.color]);
      }
      console.log('✅ Created revenue categories');

      // Create default inventory location
      const locationId = uuidv4();
      await client.query(`
        INSERT INTO inventory_locations (id, company_id, name, is_default)
        VALUES ($1, $2, $3, $4)
      `, [locationId, companyId, 'Main Warehouse', true]);
      console.log('✅ Created default inventory location');

      // Create sample suppliers
      const suppliers = [
        { name: 'Office Depot', email: 'orders@officedepot.com', phone: '1-800-463-3768' },
        { name: 'Amazon Business', email: 'business@amazon.com', phone: '1-888-280-4331' },
        { name: 'Tech Wholesale Inc', email: 'sales@techwholesale.com', phone: '1-800-555-0100' },
      ];

      for (const supplier of suppliers) {
        await client.query(`
          INSERT INTO suppliers (id, company_id, name, email, phone)
          VALUES ($1, $2, $3, $4, $5)
        `, [uuidv4(), companyId, supplier.name, supplier.email, supplier.phone]);
      }
      console.log('✅ Created sample suppliers');

      // Create sample inventory items
      const inventoryItems = [
        { sku: 'WIDGET-001', name: 'Standard Widget', quantity: 100, unitCost: 10.00, sellingPrice: 25.00 },
        { sku: 'WIDGET-002', name: 'Premium Widget', quantity: 50, unitCost: 20.00, sellingPrice: 50.00 },
        { sku: 'GADGET-001', name: 'Basic Gadget', quantity: 200, unitCost: 5.00, sellingPrice: 15.00 },
        { sku: 'SERVICE-001', name: 'Consulting Hour', quantity: 0, unitCost: 0, sellingPrice: 150.00 },
      ];

      for (const item of inventoryItems) {
        await client.query(`
          INSERT INTO inventory_items (id, company_id, sku, name, quantity, unit_cost, selling_price, reorder_level, location_id, is_service, track_inventory)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          uuidv4(), companyId, item.sku, item.name, item.quantity,
          item.unitCost, item.sellingPrice, 10, locationId,
          item.sku.startsWith('SERVICE'), !item.sku.startsWith('SERVICE')
        ]);
      }
      console.log('✅ Created sample inventory items');

      // Create sample employees
      const employees = [
        { number: 'EMP001', firstName: 'John', lastName: 'Doe', email: 'john.doe@demo.com', department: 'Engineering', position: 'Senior Developer', payType: 'salary', payRate: 85000 },
        { number: 'EMP002', firstName: 'Jane', lastName: 'Smith', email: 'jane.smith@demo.com', department: 'Sales', position: 'Sales Manager', payType: 'salary', payRate: 75000 },
        { number: 'EMP003', firstName: 'Bob', lastName: 'Johnson', email: 'bob.johnson@demo.com', department: 'Support', position: 'Support Specialist', payType: 'hourly', payRate: 25 },
      ];

      for (const emp of employees) {
        await client.query(`
          INSERT INTO employees (id, company_id, employee_number, first_name, last_name, email, department, position, hire_date, employment_type, pay_type, pay_rate)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          uuidv4(), companyId, emp.number, emp.firstName, emp.lastName,
          emp.email, emp.department, emp.position, '2023-01-15',
          'full_time', emp.payType, emp.payRate
        ]);
      }
      console.log('✅ Created sample employees');

      // Create sample operational costs
      const operationalCosts = [
        { name: 'Office Rent', category: 'Rent', amount: 5000, frequency: 'monthly' },
        { name: 'Electricity', category: 'Utilities', amount: 500, frequency: 'monthly' },
        { name: 'Internet Service', category: 'Utilities', amount: 200, frequency: 'monthly' },
        { name: 'Business Insurance', category: 'Insurance', amount: 1200, frequency: 'monthly' },
      ];

      for (const cost of operationalCosts) {
        await client.query(`
          INSERT INTO operational_costs (id, company_id, name, category, amount, frequency, start_date, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [uuidv4(), companyId, cost.name, cost.category, cost.amount, cost.frequency, '2024-01-01', adminId]);
      }
      console.log('✅ Created sample operational costs');

      await client.query('COMMIT');
      console.log('\n✨ Database seeding completed successfully!');
      console.log('\nDemo credentials:');
      console.log('  Email: admin@businesshub.com');
      console.log('  Password: admin123');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedDatabase();
