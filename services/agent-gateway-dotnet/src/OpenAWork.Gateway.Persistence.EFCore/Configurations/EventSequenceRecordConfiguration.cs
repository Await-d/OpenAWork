using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OpenAWork.Gateway.Persistence.EFCore.Entities;

namespace OpenAWork.Gateway.Persistence.EFCore.Configurations;

public sealed class EventSequenceRecordConfiguration : IEntityTypeConfiguration<EventSequenceRecord>
{
    public void Configure(EntityTypeBuilder<EventSequenceRecord> builder)
    {
        builder.ToTable("event_sequences");
        builder.HasKey((record) => record.AggregateId);
        builder.Property((record) => record.AggregateId).HasColumnName("aggregate_id").IsRequired();
        builder.Property((record) => record.Seq).HasColumnName("seq").HasDefaultValue(0L).IsRequired();
    }
}
