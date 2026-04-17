using Microsoft.EntityFrameworkCore;
using OpenAWork.Gateway.Persistence.EFCore.Configurations;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore;

public sealed class GatewayDbContext(DbContextOptions<GatewayDbContext> options) : DbContext(options)
{
    public DbSet<UserRecord> Users => Set<UserRecord>();

    public DbSet<UserSettingRecord> UserSettings => Set<UserSettingRecord>();

    public DbSet<RequestWorkflowLogRecord> RequestWorkflowLogs => Set<RequestWorkflowLogRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfiguration(new UserRecordConfiguration());
        modelBuilder.ApplyConfiguration(new UserSettingRecordConfiguration());
        modelBuilder.ApplyConfiguration(new RequestWorkflowLogRecordConfiguration());
    }
}
