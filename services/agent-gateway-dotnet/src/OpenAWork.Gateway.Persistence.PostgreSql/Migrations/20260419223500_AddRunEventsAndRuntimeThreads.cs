using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenAWork.Gateway.Persistence.PostgreSql.Migrations
{
    [DbContext(typeof(OpenAWork.Gateway.Persistence.EFCore.GatewayDbContext))]
    [Migration("20260419223500_AddRunEventsAndRuntimeThreads")]
    public partial class AddRunEventsAndRuntimeThreads : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "session_run_events",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    session_id = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: true),
                    client_request_id = table.Column<string>(type: "text", nullable: true),
                    seq = table.Column<long>(type: "bigint", nullable: true),
                    event_type = table.Column<string>(type: "text", nullable: false),
                    event_id = table.Column<string>(type: "text", nullable: true),
                    run_id = table.Column<string>(type: "text", nullable: true),
                    occurred_at_ms = table.Column<long>(type: "bigint", nullable: true),
                    payload_json = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_session_run_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_session_run_events_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_session_run_events_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "session_runtime_threads",
                columns: table => new
                {
                    session_id = table.Column<string>(type: "text", nullable: false),
                    user_id = table.Column<string>(type: "text", nullable: false),
                    client_request_id = table.Column<string>(type: "text", nullable: false),
                    started_at_ms = table.Column<long>(type: "bigint", nullable: false),
                    heartbeat_at_ms = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_session_runtime_threads", x => x.session_id);
                    table.ForeignKey(
                        name: "FK_session_runtime_threads_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_session_runtime_threads_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_session_run_events_session_request_seq",
                table: "session_run_events",
                columns: new[] { "session_id", "client_request_id", "seq" });

            migrationBuilder.CreateIndex(
                name: "IX_session_run_events_user_id",
                table: "session_run_events",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_session_runtime_threads_user_id",
                table: "session_runtime_threads",
                column: "user_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "session_run_events");
            migrationBuilder.DropTable(name: "session_runtime_threads");
        }
    }
}
