using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class RequestWorkflowLogRecordConfiguration : IEntityTypeConfiguration<RequestWorkflowLogRecord>
{
    public void Configure(EntityTypeBuilder<RequestWorkflowLogRecord> builder)
    {
        builder.ToTable("request_workflow_logs");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).ValueGeneratedOnAdd();
        builder.Property((record) => record.RequestId).HasColumnName("request_id").IsRequired();
        builder.Property((record) => record.UserId).HasColumnName("user_id");
        builder.Property((record) => record.SessionId).HasColumnName("session_id");
        builder.Property((record) => record.Method).HasColumnName("method").IsRequired();
        builder.Property((record) => record.Path).HasColumnName("path").IsRequired();
        builder.Property((record) => record.StatusCode).HasColumnName("status_code").IsRequired();
        builder.Property((record) => record.Ip).HasColumnName("ip");
        builder.Property((record) => record.UserAgent).HasColumnName("user_agent");
        builder.Property((record) => record.WorkflowJson).HasColumnName("workflow_json").IsRequired();
        builder.Property((record) => record.CreatedAtUtc).HasColumnName("created_at").IsRequired();
    }
}
