using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class EventLogRecordConfiguration : IEntityTypeConfiguration<EventLogRecord>
{
    public void Configure(EntityTypeBuilder<EventLogRecord> builder)
    {
        builder.ToTable("event_log");
        builder.HasKey((record) => record.Id);
        builder.Property((record) => record.Id).HasColumnName("id").IsRequired();
        builder.Property((record) => record.AggregateId).HasColumnName("aggregate_id").IsRequired();
        builder.Property((record) => record.Seq).HasColumnName("seq").IsRequired();
        builder.Property((record) => record.Type).HasColumnName("type").IsRequired();
        builder.Property((record) => record.Version).HasColumnName("version").IsRequired();
        builder.Property((record) => record.DataJson).HasColumnName("data").IsRequired();
        builder.Property((record) => record.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property((record) => record.CreatedAtUtc)
            .HasColumnName("created_at")
            .HasDefaultValueSql("CURRENT_TIMESTAMP")
            .IsRequired();
        builder.HasIndex((record) => new { record.AggregateId, record.Seq })
            .IsUnique()
            .HasDatabaseName("idx_event_log_aggregate_seq");
    }
}
