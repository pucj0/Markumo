using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using System.Text.Json;

if (args.Length == 0) throw new ArgumentException("Supply DOCX files to validate");
var reports = new List<object>();
var failed = false;
foreach (var file in args)
{
    try
    {
        using var document = WordprocessingDocument.Open(file, false);
        var errors = new OpenXmlValidator(FileFormatVersions.Office2016).Validate(document)
            .Select(error => new { error.Id, error.Description, Part = error.Part?.Uri.ToString(), Path = error.Path?.XPath }).ToArray();
        failed |= errors.Length > 0;
        reports.Add(new { file, valid = errors.Length == 0, errors });
    }
    catch (Exception error) { failed = true; reports.Add(new { file, valid = false, error = error.ToString() }); }
}
Console.WriteLine(JsonSerializer.Serialize(reports, new JsonSerializerOptions { WriteIndented = true }));
return failed ? 1 : 0;
