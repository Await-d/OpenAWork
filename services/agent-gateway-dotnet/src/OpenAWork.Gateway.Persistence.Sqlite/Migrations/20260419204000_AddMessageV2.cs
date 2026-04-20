using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OpenAWork.Gateway.Persistence.Sqlite.Migrations
{
    [DbContext(typeof(OpenAWork.Gateway.Persistence.EFCore.GatewayDbContext))]
    [Migration("20260419204000_AddMessageV2")]
    public partial class AddMessageV2 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "message_v2",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    session_id = table.Column<string>(type: "TEXT", nullable: false),
                    user_id = table.Column<string>(type: "TEXT", nullable: false),
                    time_created = table.Column<long>(type: "INTEGER", nullable: false),
                    data = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_message_v2", x => x.id);
                    table.ForeignKey(
                        name: "FK_message_v2_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_message_v2_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "part_v2",
                columns: table => new
                {
                    id = table.Column<string>(type: "TEXT", nullable: false),
                    message_id = table.Column<string>(type: "TEXT", nullable: false),
                    session_id = table.Column<string>(type: "TEXT", nullable: false),
                    user_id = table.Column<string>(type: "TEXT", nullable: false),
                    time_created = table.Column<long>(type: "INTEGER", nullable: false),
                    data = table.Column<string>(type: "TEXT", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    updated_at = table.Column<DateTimeOffset>(type: "TEXT", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_part_v2", x => x.id);
                    table.ForeignKey(
                        name: "FK_part_v2_message_v2_message_id",
                        column: x => x.message_id,
                        principalTable: "message_v2",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_part_v2_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "sessions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_part_v2_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "idx_message_v2_session_time",
                table: "message_v2",
                columns: new[] { "session_id", "time_created", "id" });

            migrationBuilder.CreateIndex(
                name: "IX_message_v2_user_id",
                table: "message_v2",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "idx_part_v2_message",
                table: "part_v2",
                columns: new[] { "message_id", "id" });

            migrationBuilder.CreateIndex(
                name: "idx_part_v2_session",
                table: "part_v2",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "IX_part_v2_user_id",
                table: "part_v2",
                column: "user_id");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "part_v2");
            migrationBuilder.DropTable(name: "message_v2");
        }
    }
}
