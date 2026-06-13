import json
import re
import sys
import argparse
from datetime import date, datetime, time
from pathlib import Path

import pandas as pd


REQUIRED_COLUMNS = [
    "Teacher_ID",
    "Teacher_Name",
    "Class_No",
    "Subject",
    "Room_No",
    "Date",
    "Day",
    "Start_Time",
    "End_Time",
    "Class_Type",
]
OPTIONAL_COLUMNS = ["ID", "Modified_By", "Timestamp"]
TIME_PATTERN = re.compile(r"^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$", re.IGNORECASE)
DAY_NAMES = {"SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"}


def clean_value(value):
    if pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.strftime("%I:%M %p")
    return str(value).strip()


def clean_date(value):
    if pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def clean_time(value):
    if pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%I:%M %p")
    if isinstance(value, time):
        return value.strftime("%I:%M %p")
    return str(value).strip().upper()


def validate_columns(frame):
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing columns: {', '.join(missing)}")


def validate_times(frame):
    errors = []

    for row_number, row in frame.iterrows():
        for column in ["Start_Time", "End_Time"]:
            value = clean_time(row[column])
            if not TIME_PATTERN.match(value):
                errors.append(f"Row {row_number + 2}: {column} must look like 9:30 AM or 02:15 PM.")

    if errors:
        raise ValueError("\n".join(errors))


def validate_days(frame):
    errors = []

    for row_number, row in frame.iterrows():
        value = clean_value(row["Day"]).upper()
        if value and value not in DAY_NAMES:
            errors.append(f"Row {row_number + 2}: Day must be a weekday name, but found {row['Day']}.")

    if errors:
        raise ValueError("\n".join(errors))


def normalize_record(row, row_index):
    record = {}

    for column in OPTIONAL_COLUMNS + REQUIRED_COLUMNS:
        if column not in row.index:
            continue

        if column == "Date":
            record[column] = clean_date(row[column])
        elif column in ["Start_Time", "End_Time"]:
            record[column] = clean_time(row[column])
        elif column == "Class_No":
            record[column] = clean_value(row[column])
        else:
            record[column] = clean_value(row[column])

    if not record.get("ID"):
        record["ID"] = f"SCH-{row_index + 1:04d}"

    return record


def read_schedule_file(input_file):
    if not input_file.exists():
        raise FileNotFoundError(f"Could not find {input_file}. Put the Excel file in this folder or pass its path.")

    if input_file.suffix.lower() == ".csv":
        return pd.read_csv(input_file)

    if input_file.suffix.lower() in [".xls", ".xlsx"]:
        return pd.read_excel(input_file)

    raise ValueError("Input must be an Excel file (.xlsx/.xls) or a CSV file (.csv).")


def parse_args():
    parser = argparse.ArgumentParser(description="Convert a DISS routine Excel/CSV file into app-ready JSON.")
    parser.add_argument("input", nargs="?", default="routine.xlsx", help="Path to routine.xlsx, routine.xls, or routine.csv.")
    parser.add_argument("output", nargs="?", default="data.json", help="Where to write the JSON output.")
    return parser.parse_args()


def main():
    args = parse_args()
    input_file = Path(args.input)
    output_file = Path(args.output)

    frame = read_schedule_file(input_file)
    validate_columns(frame)
    validate_times(frame)
    validate_days(frame)

    records = [normalize_record(row, index) for index, row in frame.iterrows()]

    output_file.write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"Created {output_file} with {len(records)} routine entries.")


if __name__ == "__main__":
    main()
