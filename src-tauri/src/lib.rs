// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use pdfium_bundled::pdfium_render::prelude::{
    PdfPageObjectCommon, PdfPageObjectsCommon, PdfPoints,
};
use serde::Deserialize;
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{Emitter, Manager, State};

static PDFIUM: OnceLock<Result<pdfium_bundled::pdfium_render::prelude::Pdfium, String>> =
    OnceLock::new();

struct PendingPdfPaths(Mutex<Vec<String>>);

fn is_pdf_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

#[tauri::command]
fn take_pending_pdf_paths(state: State<'_, PendingPdfPaths>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

fn shared_pdfium() -> Result<&'static pdfium_bundled::pdfium_render::prelude::Pdfium, String> {
    match PDFIUM.get_or_init(|| pdfium_bundled::bind_bundled().map_err(|error| error.to_string())) {
        Ok(pdfium) => Ok(pdfium),
        Err(error) => Err(error.clone()),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn save_pdf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct SelectionRect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

fn normalized_text_with_ranges(text: &str) -> (String, Vec<(usize, usize)>) {
    let mut normalized = String::new();
    let mut ranges = Vec::new();
    let mut whitespace_start = None;

    for (byte_index, character) in text.char_indices() {
        if character.is_whitespace() {
            if !normalized.is_empty() && whitespace_start.is_none() {
                whitespace_start = Some(byte_index);
            }
            continue;
        }

        if let Some(start) = whitespace_start.take() {
            normalized.push(' ');
            ranges.push((start, byte_index));
        }
        normalized.push(character);
        ranges.push((byte_index, byte_index + character.len_utf8()));
    }

    (normalized, ranges)
}

fn replace_text_fragment(existing: &str, selected: &str, replacement: &str) -> Option<String> {
    let (normalized_existing, existing_ranges) = normalized_text_with_ranges(existing);
    let (normalized_selected, _) = normalized_text_with_ranges(selected);
    if normalized_selected.is_empty() {
        return None;
    }

    let byte_start = normalized_existing.find(&normalized_selected)?;
    let char_start = normalized_existing[..byte_start].chars().count();
    let char_end = char_start + normalized_selected.chars().count();
    let original_start = existing_ranges.get(char_start)?.0;
    let original_end = existing_ranges.get(char_end.checked_sub(1)?)?.1;

    Some(format!(
        "{}{}{}",
        &existing[..original_start],
        replacement,
        &existing[original_end..]
    ))
}

fn shift_following_text_on_same_line(
    selected: (f32, f32, f32, f32),
    following: (f32, f32, f32, f32),
    delta_x: f32,
) -> f32 {
    let (selected_left, selected_right, selected_bottom, selected_top) = selected;
    let (following_left, following_right, following_bottom, following_top) = following;

    if delta_x == 0.0 || following_left < selected_left {
        return 0.0;
    }

    let selected_center_y = (selected_bottom + selected_top) * 0.5;
    let following_center_y = (following_bottom + following_top) * 0.5;

    if (selected_center_y - following_center_y).abs() <= 2.0 && following_right >= selected_right {
        delta_x
    } else {
        0.0
    }
}

fn left_shift_to_fit_page(
    original_left: f32,
    updated_right: f32,
    previous_right: Option<f32>,
    following_right: Option<f32>,
    growth: f32,
    page_width: f32,
) -> Result<f32, String> {
    const MAX_ALIGNMENT_SHIFT: f32 = 4.0;

    let line_right = following_right
        .map(|right| right + growth)
        .unwrap_or(updated_right)
        .max(updated_right);
    let overflow = (line_right - (page_width - 2.0)).max(0.0);
    if overflow == 0.0 {
        return Ok(0.0);
    }

    let available_space = (original_left - previous_right.unwrap_or(0.0) - 2.0)
        .max(0.0)
        .min(MAX_ALIGNMENT_SHIFT);
    if overflow > available_space {
        return Err("El reemplazo excede el renglón y moverlo más alteraría la alineación del párrafo. Prueba con un texto más corto.".into());
    }

    Ok(overflow)
}

#[tauri::command]
fn replace_pdf_text(
    bytes: Vec<u8>,
    page_number: i32,
    selection_rects: Vec<SelectionRect>,
    selected_text: String,
    replacement_text: String,
) -> Result<Vec<u8>, String> {
    if page_number <= 0 || selected_text.trim().is_empty() {
        return Err("La selección de texto no es válida.".into());
    }

    let pdfium = shared_pdfium()?;
    let mut document = pdfium
        .load_pdf_from_byte_vec(bytes, None)
        .map_err(|error| error.to_string())?;
    if page_number > document.pages().len() {
        return Err("La página seleccionada no existe en el PDF.".into());
    }

    let mut page = document
        .pages_mut()
        .get(page_number - 1)
        .map_err(|error| error.to_string())?;
    let page_width = page.width().value;
    let page_height = page.height().value;
    let objects = page.objects_mut();
    let mut best_match: Option<(usize, String, f32)> = None;

    for index in 0..objects.len() {
        let object = objects.get(index).map_err(|error| error.to_string())?;
        let Some(text_object) = object.as_text_object() else {
            continue;
        };
        let existing_text = text_object.text();
        let Some(updated_text) =
            replace_text_fragment(&existing_text, &selected_text, &replacement_text)
        else {
            continue;
        };

        let Ok(bounds) = object.bounds() else {
            continue;
        };
        let bounds = bounds.to_rect();
        let object_left = bounds.left().value / page_width;
        let object_right = bounds.right().value / page_width;
        let object_top = 1.0 - bounds.top().value / page_height;
        let object_bottom = 1.0 - bounds.bottom().value / page_height;

        let overlap = selection_rects
            .iter()
            .map(|selection| {
                let width = (object_right.min(selection.x + selection.width)
                    - object_left.max(selection.x))
                .max(0.0);
                let height = (object_bottom.min(selection.y + selection.height)
                    - object_top.max(selection.y))
                .max(0.0);
                width * height
            })
            .sum::<f32>();

        if best_match
            .as_ref()
            .is_none_or(|(_, _, best_overlap)| overlap > *best_overlap)
        {
            best_match = Some((index, updated_text, overlap));
        }
    }

    let Some((index, updated_text, overlap)) = best_match else {
        return Err("PDFium no encontró texto editable en la selección. Puede ser una imagen, texto convertido en trazos o una fuente no reconocida.".into());
    };
    if overlap <= 0.0 {
        return Err("No se encontró un objeto de texto debajo de la selección.".into());
    }

    let mut object = objects.get(index).map_err(|error| error.to_string())?;
    let original_bounds = object.bounds().map_err(|error| error.to_string())?;
    let original_left = original_bounds.left().value;
    let original_right = original_bounds.right().value;
    let original_bottom = original_bounds.bottom().value;
    let original_top = original_bounds.top().value;

    let previous_right = (0..index)
        .filter_map(|candidate_index| objects.get(candidate_index).ok())
        .filter_map(|candidate| {
            let bounds = candidate.bounds().ok()?.to_rect();
            let same_line = ((bounds.bottom().value + bounds.top().value)
                - (original_bottom + original_top))
                .abs()
                <= 4.0;
            (candidate.as_text_object().is_some()
                && same_line
                && bounds.right().value <= original_left)
                .then_some(bounds.right().value)
        })
        .max_by(f32::total_cmp);
    let following_right = (index + 1..objects.len())
        .filter_map(|candidate_index| objects.get(candidate_index).ok())
        .filter_map(|candidate| {
            let bounds = candidate.bounds().ok()?.to_rect();
            let same_line = ((bounds.bottom().value + bounds.top().value)
                - (original_bottom + original_top))
                .abs()
                <= 4.0;
            (candidate.as_text_object().is_some()
                && same_line
                && bounds.left().value >= original_left)
                .then_some(bounds.right().value)
        })
        .max_by(f32::total_cmp);

    let text_object = object
        .as_text_object_mut()
        .ok_or_else(|| "El objeto seleccionado dejó de ser texto editable.".to_string())?;
    text_object
        .set_text(updated_text)
        .map_err(|error| error.to_string())?;

    let updated_bounds = object.bounds().map_err(|error| error.to_string())?;
    let left_shift = left_shift_to_fit_page(
        original_left,
        updated_bounds.right().value,
        previous_right,
        following_right,
        updated_bounds.right().value - original_right,
        page_width,
    )?;
    if left_shift > 0.0 {
        object
            .translate(PdfPoints::new(-left_shift), PdfPoints::new(0.0))
            .map_err(|error| error.to_string())?;
    }
    let delta_x = updated_bounds.right().value - original_right - left_shift;

    for candidate_index in index + 1..objects.len() {
        let mut candidate = objects
            .get(candidate_index)
            .map_err(|error| error.to_string())?;
        let Some(candidate_bounds) = candidate.bounds().ok() else {
            continue;
        };
        let candidate_left = candidate_bounds.left().value;
        let candidate_right = candidate_bounds.right().value;
        let candidate_bottom = candidate_bounds.bottom().value;
        let candidate_top = candidate_bounds.top().value;

        let shift = shift_following_text_on_same_line(
            (original_left, original_right, original_bottom, original_top),
            (
                candidate_left,
                candidate_right,
                candidate_bottom,
                candidate_top,
            ),
            delta_x,
        );

        if shift == 0.0 {
            continue;
        }

        let current_matrix = candidate.matrix().map_err(|error| error.to_string())?;
        let translated = current_matrix
            .translate(PdfPoints::new(shift), PdfPoints::new(0.0))
            .map_err(|error| error.to_string())?;
        candidate
            .apply_matrix(translated)
            .map_err(|error| error.to_string())?;
    }

    page.regenerate_content()
        .map_err(|error| error.to_string())?;
    drop(page);

    document.save_to_bytes().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_paths = std::env::args()
        .skip(1)
        .filter(|argument| is_pdf_path(argument))
        .collect();

    tauri::Builder::default()
        .manage(PendingPdfPaths(Mutex::new(startup_paths)))
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, _cwd| {
                let paths: Vec<String> = arguments
                    .into_iter()
                    .skip(1)
                    .filter(|argument| is_pdf_path(argument))
                    .collect();
                if !paths.is_empty() {
                    if let Some(pending_paths) = app.try_state::<PendingPdfPaths>() {
                        if let Ok(mut pending_paths) = pending_paths.0.lock() {
                            pending_paths.extend(paths);
                        }
                    }
                    let _ = app.emit("open-pdf-requested", ());
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_pdf,
            replace_pdf_text,
            take_pending_pdf_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        left_shift_to_fit_page, replace_pdf_text, shift_following_text_on_same_line, SelectionRect,
    };
    use pdfium_bundled::pdfium_render::prelude::PdfPageObjectsCommon;

    fn minimal_text_pdf_at(text_x: i32) -> Vec<u8> {
        let content = format!("BT /F1 12 Tf {text_x} 700 Td (old value) Tj ET");
        let stream = format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            content.len(),
            content
        );
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
            stream,
        ];
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::with_capacity(objects.len() + 1);
        offsets.push(0usize);

        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
        }

        let xref_offset = pdf.len();
        pdf.extend_from_slice(format!("xref\n0 {}\n", offsets.len()).as_bytes());
        pdf.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF",
                offsets.len()
            )
            .as_bytes(),
        );
        pdf
    }

    fn minimal_text_pdf() -> Vec<u8> {
        minimal_text_pdf_at(72)
    }

    #[test]
    fn replaces_selected_text_inside_pdf_content() {
        let updated = replace_pdf_text(
            minimal_text_pdf(),
            1,
            vec![SelectionRect {
                x: 0.11,
                y: 0.10,
                width: 0.25,
                height: 0.04,
            }],
            "old".into(),
            "new".into(),
        )
        .expect("PDFium should replace the selected source text");

        let pdfium = super::shared_pdfium().expect("bundled PDFium should bind");
        let document = pdfium
            .load_pdf_from_byte_vec(updated, None)
            .expect("updated PDF should reopen");
        let page = document.pages().get(0).expect("PDF should retain its page");
        let object_text = page
            .objects()
            .iter()
            .filter_map(|object| object.as_text_object().map(|text| text.text()))
            .collect::<String>();

        assert_eq!(object_text, "new value");
    }

    #[test]
    fn shifts_following_text_on_the_same_line_when_replacement_grows() {
        let selected = (50.0, 120.0, 700.0, 720.0);
        let following = (200.0, 260.0, 700.0, 720.0);
        let shift = shift_following_text_on_same_line(selected, following, 40.0);

        assert_eq!(shift, 40.0);
    }

    #[test]
    fn uses_available_space_before_text_to_fit_the_page_edge() {
        let shift = left_shift_to_fit_page(500.0, 614.0, Some(450.0), None, 4.0, 612.0)
            .expect("a small adjustment should preserve paragraph alignment");

        assert_eq!(shift, 4.0);
    }

    #[test]
    fn refuses_to_shift_text_into_the_previous_fragment() {
        let error = left_shift_to_fit_page(500.0, 650.0, Some(480.0), None, 50.0, 612.0)
            .expect_err("the replacement should not overlap preceding text");

        assert!(error.contains("alteraría la alineación"));
    }

    #[test]
    fn fits_downstream_text_as_part_of_the_same_line() {
        let shift = left_shift_to_fit_page(500.0, 580.0, Some(450.0), Some(605.0), 5.0, 612.0)
            .expect("the complete line should fit after a small adjustment");

        assert_eq!(shift, 0.0);
    }

    #[test]
    fn rejects_edge_replacement_that_would_misalign_the_paragraph() {
        let error = replace_pdf_text(
            minimal_text_pdf_at(500),
            1,
            vec![SelectionRect {
                x: 0.79,
                y: 0.08,
                width: 0.18,
                height: 0.05,
            }],
            "old".into(),
            "a much longer replacement string".into(),
        )
        .expect_err("a large left shift should not distort the paragraph layout");

        assert!(error.contains("alteraría la alineación"));
    }
}
