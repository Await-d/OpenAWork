using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Persistence.EFCore.Configurations;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore;

public sealed class GatewayDbContext(DbContextOptions<GatewayDbContext> options) : DbContext(options)
{
    public DbSet<UserRecord> Users => Set<UserRecord>();

    public DbSet<RefreshTokenRecord> RefreshTokens => Set<RefreshTokenRecord>();

    public DbSet<InstalledSkillRecord> InstalledSkills => Set<InstalledSkillRecord>();

    public DbSet<WorkflowTemplateRecord> WorkflowTemplates => Set<WorkflowTemplateRecord>();

    public DbSet<SessionRecord> Sessions => Set<SessionRecord>();

    public DbSet<MessageV2Record> MessageV2 => Set<MessageV2Record>();

    public DbSet<PartV2Record> PartV2 => Set<PartV2Record>();

    public DbSet<EventLogRecord> EventLog => Set<EventLogRecord>();

    public DbSet<EventSequenceRecord> EventSequences => Set<EventSequenceRecord>();

    public DbSet<SessionRunEventRecord> SessionRunEvents => Set<SessionRunEventRecord>();

    public DbSet<SessionRuntimeThreadRecord> SessionRuntimeThreads => Set<SessionRuntimeThreadRecord>();

    public DbSet<PermissionRequestRecord> PermissionRequests => Set<PermissionRequestRecord>();

    public DbSet<PermissionDecisionLogRecord> PermissionDecisionLogs => Set<PermissionDecisionLogRecord>();

    public DbSet<QuestionRequestRecord> QuestionRequests => Set<QuestionRequestRecord>();

    public DbSet<TaskParentAutoResumeContextRecord> TaskParentAutoResumeContexts => Set<TaskParentAutoResumeContextRecord>();

    public DbSet<UserSettingRecord> UserSettings => Set<UserSettingRecord>();

    public DbSet<UsageRecord> UsageRecords => Set<UsageRecord>();

    public DbSet<RequestWorkflowLogRecord> RequestWorkflowLogs => Set<RequestWorkflowLogRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(new UserRecordConfiguration());
        modelBuilder.ApplyConfiguration(new RefreshTokenRecordConfiguration());
        modelBuilder.ApplyConfiguration(new InstalledSkillRecordConfiguration());
        modelBuilder.ApplyConfiguration(new WorkflowTemplateRecordConfiguration());
        modelBuilder.ApplyConfiguration(new SessionRecordConfiguration());
        modelBuilder.ApplyConfiguration(new MessageV2RecordConfiguration());
        modelBuilder.ApplyConfiguration(new PartV2RecordConfiguration());
        modelBuilder.ApplyConfiguration(new EventLogRecordConfiguration());
        modelBuilder.ApplyConfiguration(new EventSequenceRecordConfiguration());
        modelBuilder.ApplyConfiguration(new SessionRunEventRecordConfiguration());
        modelBuilder.ApplyConfiguration(new SessionRuntimeThreadRecordConfiguration());
        modelBuilder.ApplyConfiguration(new PermissionRequestRecordConfiguration());
        modelBuilder.ApplyConfiguration(new PermissionDecisionLogRecordConfiguration());
        modelBuilder.ApplyConfiguration(new QuestionRequestRecordConfiguration());
        modelBuilder.ApplyConfiguration(new TaskParentAutoResumeContextRecordConfiguration());
        modelBuilder.ApplyConfiguration(new UserSettingRecordConfiguration());
        modelBuilder.ApplyConfiguration(new UsageRecordConfiguration());
        modelBuilder.ApplyConfiguration(new RequestWorkflowLogRecordConfiguration());
    }
}
