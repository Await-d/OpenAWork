using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class SessionRuntimeThreadRecordConfiguration : IEntityTypeConfiguration<SessionRuntimeThreadRecord>
{
    public void Configure(EntityTypeBuilder<SessionRuntimeThreadRecord> builder)
    {
        builder.ToTable("session_runtime_threads");
        builder.HasKey((record) => record.SessionId);
        builder.Property((record) => record.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((record) => record.UserId).HasColumnName("user_id").IsRequired();
        builder.Property((record) => record.ClientRequestId).HasColumnName("client_request_id").IsRequired();
        builder.Property((record) => record.StartedAtMs).HasColumnName("started_at_ms").IsRequired();
        builder.Property((record) => record.HeartbeatAtMs).HasColumnName("heartbeat_at_ms").IsRequired();
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
        builder.HasOne((record) => record.User)
            .WithMany()
            .HasForeignKey((record) => record.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
