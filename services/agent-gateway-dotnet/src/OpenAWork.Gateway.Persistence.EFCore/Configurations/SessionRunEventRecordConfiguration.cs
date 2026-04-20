using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class SessionRunEventRecordConfiguration : IEntityTypeConfiguration<SessionRunEventRecord>
{
    public void Configure(EntityTypeBuilder<SessionRunEventRecord> builder)
    {
        builder.ToTable("session_run_events");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).HasColumnName("id").ValueGeneratedOnAdd().IsRequired();
        builder.Property((record) => record.SessionId).HasColumnName("session_id").IsRequired();
        builder.Property((record) => record.UserId).HasColumnName("user_id");
        builder.Property((record) => record.ClientRequestId).HasColumnName("client_request_id");
        builder.Property((record) => record.Seq).HasColumnName("seq");
        builder.Property((record) => record.EventType).HasColumnName("event_type").IsRequired();
        builder.Property((record) => record.EventId).HasColumnName("event_id");
        builder.Property((record) => record.RunId).HasColumnName("run_id");
        builder.Property((record) => record.OccurredAtMs).HasColumnName("occurred_at_ms");
        builder.Property((record) => record.PayloadJson).HasColumnName("payload_json").IsRequired();
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((record) => new { record.SessionId, record.ClientRequestId, record.Seq })
            .HasDatabaseName("idx_session_run_events_session_request_seq");
        builder.HasOne((record) => record.Session)
            .WithMany()
            .HasForeignKey((record) => record.SessionId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne((record) => record.User)
            .WithMany()
            .HasForeignKey((record) => record.UserId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
