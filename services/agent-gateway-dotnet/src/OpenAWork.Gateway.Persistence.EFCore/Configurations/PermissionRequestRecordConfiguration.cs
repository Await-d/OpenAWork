using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class PermissionRequestRecordConfiguration : IEntityTypeConfiguration<PermissionRequestRecord>
{
    public void Configure(EntityTypeBuilder<PermissionRequestRecord> builder)
    {
        builder.ToTable("permission_requests");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).HasColumnName("id").IsRequired();
        builder.Property((record) => record.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((record) => record.ToolName).HasColumnName("tool_name").IsRequired();
        builder.Property((record) => record.Scope).HasColumnName("scope").IsRequired();
        builder.Property((record) => record.Reason).HasColumnName("reason").IsRequired();
        builder.Property((record) => record.RiskLevel).HasColumnName("risk_level").IsRequired();
        builder.Property((record) => record.PreviewAction).HasColumnName("preview_action");
        builder.Property((record) => record.Status)
            .HasColumnName("status")
            .HasDefaultValue("pending")
            .IsRequired();
        builder.Property((record) => record.Decision).HasColumnName("decision");
        builder.Property((record) => record.RequestPayloadJson).HasColumnName("request_payload_json");
        builder.Property((record) => record.ExpiresAtMs).HasColumnName("expires_at");
        builder.Property((record) => record.AlwaysJson).HasColumnName("always_json");
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.Property((record) => record.UpdatedAtUtc)
            .HasColumnName("updated_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasOne((record) => record.Session)
            .WithMany()
            .HasForeignKey((record) => record.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
