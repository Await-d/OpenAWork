using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class PermissionDecisionLogRecordConfiguration : IEntityTypeConfiguration<PermissionDecisionLogRecord>
{
    public void Configure(EntityTypeBuilder<PermissionDecisionLogRecord> builder)
    {
        builder.ToTable("permission_decision_logs");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).ValueGeneratedOnAdd();
        builder.Property((record) => record.RequestId).HasColumnName("request_id").IsRequired();
        builder.Property((record) => record.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((record) => record.ToolName).HasColumnName("tool_name").IsRequired();
        builder.Property((record) => record.Scope).HasColumnName("scope").IsRequired();
        builder.Property((record) => record.Decision).HasColumnName("decision").IsRequired();
        builder.Property((record) => record.WorkspaceRoot).HasColumnName("workspace_root");
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
    }
}
