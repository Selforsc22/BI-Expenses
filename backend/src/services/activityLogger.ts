import { query } from '../config/database';

export type EntityType =
  | 'user'
  | 'company'
  | 'invoice'
  | 'expense'
  | 'revenue'
  | 'category'
  | 'inventory_item'
  | 'employee'
  | 'payroll'
  | 'operational_cost';

export type ActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'login'
  | 'logout'
  | 'import'
  | 'export'
  | 'approve'
  | 'reject';

interface LogEntry {
  userId: string;
  companyId: string;
  action: ActionType;
  entityType: EntityType;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class ActivityLogger {
  static async log(entry: LogEntry): Promise<void> {
    try {
      await query(
        `INSERT INTO activity_logs
         (user_id, company_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.userId,
          entry.companyId,
          entry.action,
          entry.entityType,
          entry.entityId || null,
          entry.oldValues ? JSON.stringify(entry.oldValues) : null,
          entry.newValues ? JSON.stringify(entry.newValues) : null,
          entry.ipAddress || null,
          entry.userAgent || null,
        ]
      );
    } catch (error) {
      console.error('Failed to log activity:', error);
      // Don't throw - logging should not break the main operation
    }
  }

  static async getActivityLog(
    companyId: string,
    filters: {
      userId?: string;
      entityType?: EntityType;
      entityId?: string;
      action?: ActionType;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ logs: any[]; total: number }> {
    let whereClause = 'company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    if (filters.userId) {
      whereClause += ` AND user_id = $${paramIndex++}`;
      params.push(filters.userId);
    }

    if (filters.entityType) {
      whereClause += ` AND entity_type = $${paramIndex++}`;
      params.push(filters.entityType);
    }

    if (filters.entityId) {
      whereClause += ` AND entity_id = $${paramIndex++}`;
      params.push(filters.entityId);
    }

    if (filters.action) {
      whereClause += ` AND action = $${paramIndex++}`;
      params.push(filters.action);
    }

    if (filters.startDate) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      whereClause += ` AND created_at <= $${paramIndex++}`;
      params.push(filters.endDate);
    }

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM activity_logs WHERE ${whereClause}`,
      params
    );

    const total = parseInt(countResult[0]?.count || '0');

    // Get logs with pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const logs = await query(
      `SELECT al.*, u.email as user_email, u.first_name, u.last_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    );

    return { logs, total };
  }

  static async getEntityHistory(
    companyId: string,
    entityType: EntityType,
    entityId: string
  ): Promise<any[]> {
    return query(
      `SELECT al.*, u.email as user_email, u.first_name, u.last_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.company_id = $1 AND al.entity_type = $2 AND al.entity_id = $3
       ORDER BY al.created_at DESC`,
      [companyId, entityType, entityId]
    );
  }

  static async getUserActivity(
    companyId: string,
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    return query(
      `SELECT *
       FROM activity_logs
       WHERE company_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [companyId, userId, limit]
    );
  }
}

export default ActivityLogger;
